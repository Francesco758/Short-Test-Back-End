const { prisma } = require('../utils/prismaClient');
const { streamChatCompletion, evaluateAnswer, runChatWithTools, defaultTools } = require('./gptService');
const teamService = require('./teamService');
const logger = require('../utils/logger');
const { ConflictError, ValidationError } = require('../utils/errors');
const { buildLaunchMetadata } = require('../utils/helpers');

const MAX_MESSAGES_PER_ATTEMPT = 50;
const MIN_MESSAGE_INTERVAL_MS = 2000;
const MAX_IMAGE_GENERATIONS_PER_ATTEMPT = 8;

/**
 * Simplified Dynamic Conversation Service
 * - No fixed phases
 * - GPT guides the entire conversation
 * - Single system prompt per test
 */

/**
 * Start a new test conversation
 */
async function startTestConversation({ user, body, requestId }) {
  const { userTestId, source, context } = body;

  const log = logger.child({ requestId, userTestId, component: 'startTest' });

  if (!userTestId) {
    throw new ValidationError('userTestId is required');
  }

  // Get user test with test details
  const userTest = await prisma.userTest.findFirst({
    where: {
      id: parseInt(userTestId),
      userId: user.id
    },
    include: {
      test: true,
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  });

  if (!userTest) {
    throw new Error('Test not found or not assigned to you');
  }

  // Guests may only take tests while their company's guest mode is on.
  // Deactivation flips Company.guestMode off, which must immediately stop any
  // still-logged-in guest from starting or resuming.
  if (user?.isGuest && user?.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { guestMode: true }
    });
    if (company?.guestMode !== true) {
      throw new ValidationError('Guest access is no longer enabled for this company');
    }
  }

  if (userTest.status === 'COMPLETED') {
    throw new Error('Test already completed');
  }

  // Check if test has system prompt
  if (!userTest.test.systemPrompt) {
    throw new Error('Test configuration incomplete - no system prompt');
  }

  // Create or get existing test attempt
  let testAttempt;
  
  if (userTest.attempts.length > 0 && !userTest.attempts[0].isCompleted) {
    // Continue existing attempt
    testAttempt = userTest.attempts[0];
  } else {
    // Create new attempt
    // Optional launch attribution (originating system + optional context such as
    // an email subject or a Teams message) is stored on the existing JSON
    // metadata column. When no source/context is sent, nothing is written and
    // behaviour is exactly as before.
    const launchMetadata = buildLaunchMetadata({ source, context });

    testAttempt = await prisma.testAttempt.create({
      data: {
        userTestId: userTest.id,
        testId: userTest.test.id,
        messageCount: 0,
        isCompleted: false,
        ...(launchMetadata ? { metadata: launchMetadata } : {})
      }
    });

    // Update user test status
    await prisma.userTest.update({
      where: { id: userTest.id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date()
      }
    });
  }

  // Get all previous messages for context
  const previousMessages = await prisma.gPTMessage.findMany({
    where: { testAttemptId: testAttempt.id },
    orderBy: { createdAt: 'asc' }
  });

  // If no previous messages, handle initial state
  if (previousMessages.length === 0) {
    let initialGptResponse = null;

    // For Normal Tests (not custom), generate an initial GPT response
    if (!userTest.test.isCustom) {
      try {
        const chatResult = await runChatWithTools({
          messages: [
            {
              role: 'system',
              content: userTest.test.systemPrompt + 
                "\n\nIMPORTANT: Start the assessment professionally. Introduce yourself briefly and ask the first assessment question."
            }
          ],
          temperature: 0.7,
          tools: defaultTools(),
          context: { userId: user.id, companyId: user.companyId, source: 'test_message' }
        });
        
        const rawGptResponse = chatResult.gptResponse || chatResult.content;
        const toolOutputs = chatResult.toolOutputs || [];
        const components = buildComponentsFromToolOutputs(toolOutputs);
        
        let cleanedInitialResponse = rawGptResponse;
        if (components && components.imageUrl && !components.imageUrl.startsWith('data:')) {
          const url = components.imageUrl;
          const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          cleanedInitialResponse = cleanedInitialResponse.replace(new RegExp(`!\\[.*?\\]\\(${escapedUrl}\\)`, 'g'), '');
          cleanedInitialResponse = cleanedInitialResponse.replace(new RegExp(escapedUrl, 'g'), '');
          cleanedInitialResponse = cleanedInitialResponse.trim();
        }

        initialGptResponse = cleanedInitialResponse;

        // Save initial assistant message
        await prisma.gPTMessage.create({
          data: {
            testAttemptId: testAttempt.id,
            role: 'assistant',
            content: initialGptResponse
          }
        });

        // Also create a TestAnswer entry for the initial message if it has components
        // messageIndex 0 for initial message
        await prisma.testAnswer.create({
          data: {
            testAttemptId: testAttempt.id,
            messageIndex: 0,
            userMessage: '',
            gptResponse: initialGptResponse,
            components: components || undefined
          }
        });

        return {
          testAttemptId: testAttempt.id,
          gptResponse: initialGptResponse,
          messageCount: 1,
          isCompleted: false,
          messages: [{
            role: 'assistant',
            content: initialGptResponse,
            createdAt: new Date(),
            components: components || undefined
          }],
          components: components || undefined,
          brief: userTest.brief,
          isCustom: userTest.test.isCustom,
          testTitle: userTest.test.title
        };
    } catch (err) {
        log.error({ err }, 'Failed to generate initial GPT response');
      }
    }

    return {
      testAttemptId: testAttempt.id,
      gptResponse: initialGptResponse,
      messageCount: initialGptResponse ? 1 : 0,
      isCompleted: false,
      messages: initialGptResponse ? [{
        role: 'assistant',
        content: initialGptResponse,
        createdAt: new Date()
      }] : [],
      brief: userTest.brief,
      isCustom: userTest.test.isCustom,
      testTitle: userTest.test.title
    };
  }

  // Return existing conversation with components
  const testAnswers = await prisma.testAnswer.findMany({
    where: { testAttemptId: testAttempt.id },
    orderBy: { messageIndex: 'asc' }
  });

  const formattedMessages = [];
  let answerIdx = 0;
  
  for (const msg of previousMessages) {
    const formatted = {
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      timestamp: msg.createdAt
    };

    if (msg.role === 'assistant') {
      // Pair assistant messages with TestAnswers in chronological order
      // (each TestAnswer corresponds to one exchange; initial assistant is index 0)
      const matchingAnswer = testAnswers[answerIdx];
      if (matchingAnswer && matchingAnswer.components) {
        formatted.components = matchingAnswer.components;
      }
      answerIdx++;
    }
    formattedMessages.push(formatted);
  }

  return {
    testAttemptId: testAttempt.id,
    messages: formattedMessages,
    messageCount: previousMessages.length,
    isCompleted: testAttempt.isCompleted,
    brief: userTest.brief,
    isCustom: userTest.test.isCustom,
    testTitle: userTest.test.title
  };
}

/**
 * Handle user message in ongoing conversation
 */
async function handleUserMessage({ user, body, requestId }) {
  const { userTestId, message } = body;
  const log = logger.child({ requestId, userTestId, component: 'handleMessage' });

  if (!userTestId || !message || message.trim().length === 0) {
    throw new Error('userTestId and message are required');
  }

  // Get user test with attempt
  const userTest = await prisma.userTest.findFirst({
    where: {
      id: parseInt(userTestId),
      userId: user.id
    },
    include: {
      test: true,
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          gptMessages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      }
    }
  });

  if (!userTest || userTest.attempts.length === 0) {
    throw new Error('Test attempt not found');
  }

  const testAttempt = userTest.attempts[0];

  if (testAttempt.isCompleted) {
    throw new Error('This test has already been completed');
  }

  // Rate limit: max messages per attempt
  if (testAttempt.messageCount >= MAX_MESSAGES_PER_ATTEMPT && message.trim().toLowerCase() !== 'finish my test') {
    const err = new Error(`Maximum of ${MAX_MESSAGES_PER_ATTEMPT} messages reached. Please finish your test.`);
    err.status = 429;
    throw err;
  }

  // Rate limit: minimum interval between messages (skip for manual finish)
  if (testAttempt.gptMessages.length > 0 && message.trim().toLowerCase() !== 'finish my test') {
    const lastMsg = testAttempt.gptMessages[testAttempt.gptMessages.length - 1];
    const elapsed = Date.now() - new Date(lastMsg.createdAt).getTime();
    if (elapsed < MIN_MESSAGE_INTERVAL_MS) {
      const err = new Error('Please wait a moment before sending another message.');
      err.status = 429;
      throw err;
    }
  }

  // ✅ MANUAL FINISH TRIGGER: Check if user wants to end the test
  const isManualFinish = message.trim().toLowerCase() === 'finish my test';

  // Save user message
  await prisma.gPTMessage.create({
    data: {
      testAttemptId: testAttempt.id,
      role: 'user',
      content: message.trim()
    }
  });

  // Save as TestAnswer for record
  const messageIndex = testAttempt.messageCount + 1;
  await prisma.testAnswer.create({
    data: {
      testAttemptId: testAttempt.id,
      messageIndex,
      userMessage: message.trim()
    }
  });

  let gptResponse;
  let toolOutputs = [];
  let shouldComplete = false;

  if (isManualFinish) {
     // Short-circuit GPT call if user manually finishes
     gptResponse = "Thank you. Your assessment is now complete. Generating your report...";
     shouldComplete = true;

     // Force mark the attempt as completed in DB immediately to prevent further messages
     await prisma.testAttempt.update({
       where: { id: testAttempt.id },
       data: { isCompleted: true }
     });
   } else {
    // Build conversation history
    const conversationHistory = [
      {
        role: 'system',
        content: (userTest.test.isCustom
          ? `${userTest.test.systemPrompt}\n\nContext: Company Brief -> ${userTest.brief || 'N/A'}`
          : userTest.test.systemPrompt) + 
          "\n\nIMPORTANT COMPLETION INSTRUCTION: When you have covered all required assessment areas and are ready to conclude, you MUST clearly state that the assessment is complete. Use phrases like 'The assessment is now complete' or 'We have finished the assessment'. This is critical for the system to generate the report." +
          "\n\nIMPORTANT TOOL INSTRUCTION: You have access to tools for web search, image generation, and chart creation. Use them proactively whenever you need real-time information or want to provide visual aids. If you use a tool to generate an image or a chart, DO NOT include the raw URL or the JSON data in your text response. Simply state that the visual has been generated. The system will automatically render it for the user."
      },
      ...testAttempt.gptMessages.map(m => ({
        role: m.role,
        content: m.content
      })),
      {
        role: 'user',
        content: message.trim()
      }
    ];

    // Rate limit: count existing image generations in this attempt
    const existingAnswers = await prisma.testAnswer.findMany({
      where: { testAttemptId: testAttempt.id },
      select: { components: true }
    });
    const existingImageCount = existingAnswers.filter(a => a.components?.imageUrl).length;
    const testContext = { userId: user.id, companyId: user.companyId, source: 'test_message' };
    if (existingImageCount >= MAX_IMAGE_GENERATIONS_PER_ATTEMPT) {
      // Strip image generation tool from available tools to prevent further image calls
      const filteredTools = defaultTools().filter(t => t.function?.name !== 'generate_image');
      const chatResult = await runChatWithTools({
        messages: conversationHistory,
        temperature: 0.7,
        tools: filteredTools,
        context: testContext
      });
      gptResponse = chatResult.gptResponse || chatResult.content;
      toolOutputs = chatResult.toolOutputs || [];
    } else {
      const chatResult = await runChatWithTools({
        messages: conversationHistory,
        temperature: 0.7,
        tools: defaultTools(),
        context: testContext
      });
      gptResponse = chatResult.gptResponse || chatResult.content;
      toolOutputs = chatResult.toolOutputs || [];
    }

    // Check if GPT indicates completion
    const completionKeywords = [
      'assessment is now complete',
      'completed the assessment',
      'finished the assessment',
      'end of the assessment',
      'assessment is complete',
      'concluded the assessment',
      'generating your report',
      'generated your report',
      'here is your report',
      'here is your final evaluation',
      'your test is complete',
      'this test is now complete',
      'you have completed the',
      'your results have been recorded',
      'shortest is now complete',
      'test is now complete',
      'the assessment is finished'
    ];

    // ✅ AUTO-COMPLETE: If GPT generates a chart, it's a strong signal of completion
    const hasChart = toolOutputs.some(t => t.name === 'generate_chart_spec');

    shouldComplete = hasChart || completionKeywords.some(keyword =>
      gptResponse.toLowerCase().includes(keyword)
    );

    // If GPT decided to complete, mark it in the DB immediately
    if (shouldComplete) {
      await prisma.testAttempt.update({
        where: { id: testAttempt.id },
        data: { isCompleted: true }
      });
    }
  }

  // Persist assistant message
  // Clean up gptResponse to remove raw URLs that are already in components
  let cleanedGptResponse = gptResponse;
  const components = buildComponentsFromToolOutputs(toolOutputs);
  
  if (components && components.imageUrl) {
    const url = components.imageUrl;
    // Skip regex cleaning for data URIs (base64/SVG) — they're never in GPT text
    if (!url.startsWith('data:')) {
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mdImageRegex = new RegExp(`!\\[.*?\\]\\(${escapedUrl}\\)`, 'g');
      cleanedGptResponse = cleanedGptResponse.replace(mdImageRegex, '');
      const rawUrlRegex = new RegExp(escapedUrl, 'g');
      cleanedGptResponse = cleanedGptResponse.replace(rawUrlRegex, '');
    }
    cleanedGptResponse = cleanedGptResponse.replace(/\n\n+/g, '\n\n').trim();
  }

  await prisma.gPTMessage.create({
    data: {
      testAttemptId: testAttempt.id,
      role: 'assistant',
      content: cleanedGptResponse
    }
  });

  // Update TestAnswer with GPT response and components (if any)
  await prisma.testAnswer.updateMany({
    where: {
      testAttemptId: testAttempt.id,
      messageIndex
    },
    data: {
      gptResponse: cleanedGptResponse,
      components: components ? components : undefined
    }
  });

  // Update message count
  const newMessageCount = testAttempt.messageCount + 1;
  await prisma.testAttempt.update({
    where: { id: testAttempt.id },
    data: { messageCount: newMessageCount }
  });

  // ✅ AUTO-COMPLETE: If GPT detected completion, run evaluation synchronously
  // so the report is ready before /message returns and /complete returns instantly.
  if (shouldComplete) {
    log.info('Completing test synchronously');
    let evaluationResult = null;
    try {
      const completeResult = await completeTest({ user, userTestId, requestId });
      evaluationResult = completeResult.evaluation || null;
    } catch (err) {
      if (err instanceof ConflictError || err.status === 409) {
        log.info('Completion already handled');
      } else {
        log.error({ err }, 'Error in synchronous completion');
      }
    }
    
    return {
      testAttemptId: testAttempt.id,
      gptResponse: cleanedGptResponse,
      messageCount: newMessageCount,
      isCompleted: true,
      suggestedCompletion: true,
      components,
      evaluation: evaluationResult
    };
  }

  return {
    testAttemptId: testAttempt.id,
    gptResponse: cleanedGptResponse,
    messageCount: newMessageCount,
    isCompleted: shouldComplete,
    suggestedCompletion: shouldComplete,
    components
  };
}

/**
 * Complete the test and generate report
 */
async function completeTest({ user, userTestId, requestId }) {
  const log = logger.child({ requestId, userTestId, component: 'completeTest' });

  const userTest = await prisma.userTest.findFirst({
    where: {
      id: parseInt(userTestId),
      userId: user.id
    },
    include: {
      test: true,
      report: true, // Include existing report
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          answers: true,
          gptMessages: true
        }
      }
    }
  });

  if (!userTest || userTest.attempts.length === 0) {
    throw new Error('Test attempt not found');
  }

  // ✅ IDEMPOTENCY CHECK: If already completed and report exists, return it immediately
  if (userTest.status === 'COMPLETED' && userTest.report) {
    log.info('Test already completed. Returning existing report.');
    return {
      message: 'Test already completed',
      evaluation: {
        overallScore: userTest.report.kpis.final,
        summary: userTest.report.summary,
        creativity: userTest.report.kpis.components?.creativity,
        feasibility: userTest.report.kpis.components?.feasibility,
        proactivity: userTest.report.kpis.components?.proactivity,
        strengths: userTest.report.kpis.strengths,
        improvements: userTest.report.kpis.improvements
      },
      reportId: userTest.report.id
    };
  }

  const testAttempt = userTest.attempts[0];

  // ✅ LOCKING MECHANISM: Try to mark as COMPLETED immediately to prevent concurrent evaluations
  // If status is already COMPLETED, another process beat us to it.
  try {
    const updatedUserTest = await prisma.userTest.updateMany({
      where: { 
        id: userTest.id,
        status: { not: 'COMPLETED' } // Only update if not already completed
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date()
      }
    });

    if (updatedUserTest.count === 0) {
      log.warn('Lock acquisition failed - test already being processed');
      throw new ConflictError('Test evaluation already in progress', 'ALREADY_COMPLETED');
    }

    log.info('Lock acquired. Proceeding with evaluation.');
  } catch (err) {
    // If update fails because of the 'where' clause or explicit error, it means it's already COMPLETED or being processed
    log.warn('Test already being processed. Polling for report...');
    
    // Polling mechanism to wait for the other process to finish evaluation and create the report
    let finalUserTest;
    const maxPollAttempts = 15;
    const pollInterval = 500;

    for (let i = 0; i < maxPollAttempts; i++) {
      finalUserTest = await prisma.userTest.findUnique({
        where: { id: userTest.id },
        include: { report: true }
      });

      if (finalUserTest?.report) {
        log.info({ pollAttempts: i + 1 }, 'Report found after polling');
        return {
          message: 'Test completed',
          evaluation: {
            overallScore: finalUserTest.report.kpis.final,
            summary: finalUserTest.report.summary,
            creativity: finalUserTest.report.kpis.components?.creativity,
            feasibility: finalUserTest.report.kpis.components?.feasibility,
            proactivity: finalUserTest.report.kpis.components?.proactivity,
            strengths: finalUserTest.report.kpis.strengths,
            improvements: finalUserTest.report.kpis.improvements
          },
          reportId: finalUserTest.report.id
        };
      }
      
      if (i < maxPollAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    const error = new Error('Test evaluation is taking longer than expected. Please wait a moment.');
    error.status = 409; // Still a conflict, but we tried polling
    throw error;
  }

  // Mark attempt as completed
  await prisma.testAttempt.update({
    where: { id: testAttempt.id },
    data: { isCompleted: true }
  });

  // Generate evaluation using GPT — single consolidated call
  const conversationSummary = testAttempt.answers
    .map((a, i) => `Exchange ${i + 1}:\nUser: ${a.userMessage}\nGPT: ${a.gptResponse || 'N/A'}`)
    .join('\n\n');

  const systemPrompt = userTest.test.systemPrompt || 'No specific assessment criteria provided.';
  const evaluationPrompt = `You are an evaluator. Use the following assessment criteria to evaluate the user's responses.

ASSESSMENT CRITERIA:
${systemPrompt}

Based on the conversation below, score the user on each of the 6 dimensions and provide detailed analysis.

CONVERSATION:
${conversationSummary}

Return ONLY valid JSON with these exact keys:
{
  "simplification": <0-100>,
  "originality": <0-100>,
  "feasibility": <0-100>,
  "criticalThinking": <0-100>,
  "proactivity": <0-100>,
  "impact": <0-100>,
  "summary": "<detailed paragraph>",
  "strengths": ["strength1", "strength2", ...],
  "improvements": ["improvement1", "improvement2", ...],
  "reasoning": "<rationale for scores>",
  "confidence": <0-100>,
  "problem_summary": "<what problem the user addressed>",
  "solution_summary": "<what solution the user proposed>",
  "problem_cluster": "<category slug e.g. INTERNAL_COMM>",
  "solution_cluster": "<category slug e.g. PROCESS_OPTIMIZATION>",
  "problem_key": "<stable slug>",
  "problem_topic": "<human-readable title>",
  "solution_key": "<stable slug>",
  "solution_topic": "<human-readable title>"
}

IMPORTANT: All scores must be integers between 0 and 100.`;

  let evaluationResult;
  let evaluationAttempts = 0;
  const maxRetries = 2;
  
  const evaluationModel = process.env.OPENAI_EVAL_MODEL || 'gpt-4o-mini';
  while (evaluationAttempts < maxRetries) {
    try {
      evaluationAttempts++;
      log.info({ attempt: evaluationAttempts, maxRetries }, 'Starting evaluation attempt');
      
      evaluationResult = await evaluateAnswer({
        model: evaluationModel,
        messages: [
          { role: 'system', content: 'You are an objective evaluator. Return only valid JSON with all required fields.' },
          { role: 'user', content: evaluationPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        context: { userId: user.id, companyId: user.companyId, source: 'test_evaluation' }
      });
      
      // Validate, normalize, and compute overallScore
      evaluationResult = validateAndNormalizeEvaluation(evaluationResult);
      
      log.info({
        attempt: evaluationAttempts,
        ckpi: {
          simplification: evaluationResult.simplification,
          originality: evaluationResult.originality,
          feasibility: evaluationResult.feasibility,
          criticalThinking: evaluationResult.criticalThinking,
          proactivity: evaluationResult.proactivity,
          impact: evaluationResult.impact
        },
        overallScore: evaluationResult.overallScore,
        confidence: evaluationResult.confidence || 'N/A',
        messageCount: testAttempt.messageCount
      }, 'Evaluation succeeded');
      
      break; // Success, exit retry loop
      
    } catch (err) {
      log.warn({ err, attempt: evaluationAttempts }, 'Evaluation attempt failed');
      
      if (evaluationAttempts >= maxRetries) {
        // Final fallback after all retries failed — use 0/null to avoid polluting averages
        log.warn({ maxRetries }, 'All attempts failed. Using zeroed fallback evaluation.');
        evaluationResult = {
          simplification: 0,
          originality: 0,
          feasibility: 0,
          criticalThinking: 0,
          proactivity: 0,
          impact: 0,
          summary: null,
          strengths: [],
          improvements: [],
          reasoning: null,
          confidence: 0,
          problem_summary: null,
          solution_summary: null,
          problem_cluster: null,
          solution_cluster: null,
          problem_key: null,
          problem_topic: null,
          solution_key: null,
          solution_topic: null,
          overallScore: 0
        };
      } else {
        // Wait before retry (exponential backoff)
        const waitTime = Math.pow(2, evaluationAttempts) * 500; // 1s, 2s
        log.info({ waitTime }, 'Retrying evaluation');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Save KPIs to attempt
  await prisma.testAttempt.update({
    where: { id: testAttempt.id },
    data: {
      kpis: {
        final: evaluationResult.overallScore,
        components: {
          simplification: evaluationResult.simplification,
          originality: evaluationResult.originality,
          feasibility: evaluationResult.feasibility,
          criticalThinking: evaluationResult.criticalThinking,
          proactivity: evaluationResult.proactivity,
          impact: evaluationResult.impact,
          creativity: evaluationResult.originality
        }
      }
    }
  });

  // Create or update report
  const existingReport = await prisma.report.findUnique({
    where: { userTestId: userTest.id }
  });

  // Calculate total time if available
  const totalTime = userTest.startedAt && userTest.completedAt
    ? Math.round((new Date(userTest.completedAt) - new Date(userTest.startedAt)) / 1000)
    : null;

  const reportData = {
    summary: evaluationResult.summary,
    kpis: {
      final: evaluationResult.overallScore,
      components: {
        simplification: evaluationResult.simplification,
        originality: evaluationResult.originality,
        feasibility: evaluationResult.feasibility,
        criticalThinking: evaluationResult.criticalThinking,
        proactivity: evaluationResult.proactivity,
        impact: evaluationResult.impact,
        creativity: evaluationResult.originality
      },
      strengths: evaluationResult.strengths,
      improvements: evaluationResult.improvements,
      evaluationMetadata: {
        confidence: evaluationResult.confidence,
        reasoning: evaluationResult.reasoning,
        evaluatedAt: new Date().toISOString(),
        messageCount: testAttempt.messageCount,
        evaluationAttempts: evaluationAttempts,
        modelVersion: evaluationModel,
        scoringVersion: 'ckpi-v1'
      }
    },
    detailedAnalysis: {
      messageCount: testAttempt.messageCount,
      totalTime: totalTime,
      conversationSummary: conversationSummary.substring(0, 5000),
      evaluationConfidence: evaluationResult.confidence,
      evaluationReasoning: evaluationResult.reasoning,
      problem_summary: evaluationResult.problem_summary || null,
      solution_summary: evaluationResult.solution_summary || null,
      problem_cluster: evaluationResult.problem_cluster || null,
      solution_cluster: evaluationResult.solution_cluster || null,
      problem_key: evaluationResult.problem_key || null,
      problem_topic: evaluationResult.problem_topic || null,
      solution_key: evaluationResult.solution_key || null,
      solution_topic: evaluationResult.solution_topic || null
    }
  };

  if (existingReport) {
    await prisma.report.update({
      where: { id: existingReport.id },
      data: reportData
    });
  } else {
    await prisma.report.create({
      data: {
        userTestId: userTest.id,
        ...reportData
      }
    });
  }

  // Extract team problems and solutions from evaluation (fire-and-forget)
  if (userTest.companyId && evaluationResult) {
    teamService.extractFromEvaluation(evaluationResult, userTest.companyId, user.id)
      .catch(err => log.warn({ err }, 'Failed to extract team problems'));
  }

  // Sync report embeddings for RAG (fire-and-forget, additive — never touches source data)
  if (userTest.companyId) {
    const { ensureReportEmbeddings } = require('./embeddingService');
    ensureReportEmbeddings(userTest.companyId)
      .then((res) => {
        if (res && (res.created || res.updated)) {
          log.info({ created: res.created, updated: res.updated }, 'Report embeddings synced');
        }
      })
      .catch(err => log.warn({ err }, 'Failed to sync report embeddings'));
  }

  // Update user test status with completion time
  const completedAt = new Date();
  await prisma.userTest.update({
    where: { id: userTest.id },
    data: {
      status: 'COMPLETED',
      completedAt: completedAt,
      totalTime: totalTime
    }
  });

  return {
    message: 'Test completed successfully',
    evaluation: evaluationResult,
    reportId: existingReport?.id
  };
}

/**
 * Validate and normalize evaluation results
 * Ensures all 6 CKPI scores are within 0-100 range and computes overallScore as their average.
 */
function validateAndNormalizeEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') {
    throw new Error('Invalid evaluation result: not an object');
  }

  const clampScore = (score, fieldName) => {
    if (typeof score !== 'number' || isNaN(score)) {
      logger.warn({ fieldName, score }, 'Invalid score, defaulting to 0');
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  };

  const ckpiKeys = ['simplification', 'originality', 'feasibility', 'criticalThinking', 'proactivity', 'impact'];

  const components = {};
  for (const key of ckpiKeys) {
    components[key] = clampScore(evaluation[key], key);
  }

  // Compute overallScore as the average of all 6 CKPI dimensions
  const overallScore = Math.round(
    ckpiKeys.reduce((sum, key) => sum + components[key], 0) / ckpiKeys.length
  );

  const validated = {
    simplification: components.simplification,
    originality: components.originality,
    feasibility: components.feasibility,
    criticalThinking: components.criticalThinking,
    proactivity: components.proactivity,
    impact: components.impact,
    overallScore,
    // Legacy alias for backward compatibility
    creativity: components.originality,
    summary: typeof evaluation.summary === 'string' && evaluation.summary.trim()
      ? evaluation.summary.trim()
      : null,
    strengths: Array.isArray(evaluation.strengths) && evaluation.strengths.length > 0
      ? evaluation.strengths.filter(s => typeof s === 'string' && s.trim()).slice(0, 5)
      : [],
    improvements: Array.isArray(evaluation.improvements) && evaluation.improvements.length > 0
      ? evaluation.improvements.filter(i => typeof i === 'string' && i.trim()).slice(0, 5)
      : [],
    reasoning: typeof evaluation.reasoning === 'string' && evaluation.reasoning.trim()
      ? evaluation.reasoning.trim()
      : null,
    confidence: clampScore(evaluation.confidence || 0, 'confidence'),
    problem_summary: typeof evaluation.problem_summary === 'string' && evaluation.problem_summary.trim()
      ? evaluation.problem_summary.trim()
      : null,
    solution_summary: typeof evaluation.solution_summary === 'string' && evaluation.solution_summary.trim()
      ? evaluation.solution_summary.trim()
      : null,
    problem_cluster: typeof evaluation.problem_cluster === 'string' && evaluation.problem_cluster.trim()
      ? evaluation.problem_cluster.trim()
      : null,
    solution_cluster: typeof evaluation.solution_cluster === 'string' && evaluation.solution_cluster.trim()
      ? evaluation.solution_cluster.trim()
      : null,
    problem_key: typeof evaluation.problem_key === 'string' && evaluation.problem_key.trim()
      ? evaluation.problem_key.trim()
      : null,
    problem_topic: typeof evaluation.problem_topic === 'string' && evaluation.problem_topic.trim()
      ? evaluation.problem_topic.trim()
      : null,
    solution_key: typeof evaluation.solution_key === 'string' && evaluation.solution_key.trim()
      ? evaluation.solution_key.trim()
      : null,
    solution_topic: typeof evaluation.solution_topic === 'string' && evaluation.solution_topic.trim()
      ? evaluation.solution_topic.trim()
      : null
  };

  const adjusted = ckpiKeys.some(key => evaluation[key] !== validated[key]);
  if (adjusted) {
    const originalScores = ckpiKeys.reduce((o, key) => { o[key] = evaluation[key]; return o; }, {});
    const validatedScores = ckpiKeys.reduce((o, key) => { o[key] = validated[key]; return o; }, { overallScore });
    logger.warn({ original: originalScores, validated: validatedScores }, 'CKPI scores were adjusted');
  }

  return validated;
}

/**
 * Build frontend-friendly components from tool outputs
 */
function buildComponentsFromToolOutputs(toolOutputs = []) {
  if (!toolOutputs || toolOutputs.length === 0) return null;
  const result = {
    chartSpecs: [] // Support multiple charts
  };
  for (const t of toolOutputs) {
    if (t.name === 'generate_image' && t.output?.url) {
      result.imageUrl = t.output.url;
      result.imageSize = t.output.size;
    }
    if (t.name === 'generate_chart_spec' && t.output) {
      result.chartSpecs.push(t.output);
    }
    if (t.name === 'web_fetch' && t.output) {
      result.webSummary = t.output;
    }
    if (t.name === 'web_search' && t.output) {
      result.webSearch = t.output;
    }
  }

  // Cleanup empty arrays or objects
  if (result.chartSpecs.length === 0) delete result.chartSpecs;
  
  return Object.keys(result).length ? result : null;
}

// Heartbeat — called by frontend during active test to keep it alive
async function heartbeat({ userTestId, userId }) {
  const userTest = await prisma.userTest.findFirst({
    where: { id: userTestId, userId, status: 'IN_PROGRESS' },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } }
  });
  if (!userTest) return { found: false };
  const attempt = userTest.attempts[0];
  if (!attempt) return { found: true, completed: false };

  // Touch the attempt to keep it alive
  await prisma.testAttempt.update({
    where: { id: attempt.id },
    data: {}
  });

  return { found: true, completed: false };
}

module.exports = {
  startTestConversation,
  handleUserMessage,
  completeTest,
  heartbeat
};
