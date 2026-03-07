const { prisma } = require('../utils/prismaClient');
const { streamChatCompletion, evaluateAnswer, runChatWithTools, defaultTools } = require('./gptService');

/**
 * Simplified Dynamic Conversation Service
 * - No fixed phases
 * - GPT guides the entire conversation
 * - Single system prompt per test
 */

/**
 * Start a new test conversation
 */
async function startTestConversation({ user, body }) {
  const { userTestId } = body;

  if (!userTestId) {
    throw new Error('userTestId is required');
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
    testAttempt = await prisma.testAttempt.create({
      data: {
        userTestId: userTest.id,
        testId: userTest.test.id,
        messageCount: 0,
        isCompleted: false
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
          tools: defaultTools()
        });
        
        const rawGptResponse = chatResult.gptResponse || chatResult.content;
        const toolOutputs = chatResult.toolOutputs || [];
        const components = buildComponentsFromToolOutputs(toolOutputs);
        
        let cleanedInitialResponse = rawGptResponse;
        if (components && components.imageUrl) {
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
        console.error('Failed to generate initial GPT response:', err);
        // Fallback or just continue with null
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
      // Find matching answer to get components
      const matchingAnswer = testAnswers.find(a => a.gptResponse === msg.content);
      if (matchingAnswer && matchingAnswer.components) {
        formatted.components = matchingAnswer.components;
      }
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
async function handleUserMessage({ user, body }) {
  const { userTestId, message } = body;

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

    // Use non-stream with tools
    const chatResult = await runChatWithTools({
      messages: conversationHistory,
      temperature: 0.7,
      tools: defaultTools()
    });
    gptResponse = chatResult.gptResponse || chatResult.content;
    toolOutputs = chatResult.toolOutputs || [];

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
      'your test is complete'
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
    // Remove the raw URL if it appears in the text
    // Also try to remove markdown image syntax if it's there
    const url = components.imageUrl;
    // Escape URL for regex
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Pattern 1: Markdown image ![alt](url)
    const mdImageRegex = new RegExp(`!\\[.*?\\]\\(${escapedUrl}\\)`, 'g');
    cleanedGptResponse = cleanedGptResponse.replace(mdImageRegex, '');
    
    // Pattern 2: Raw URL
    const rawUrlRegex = new RegExp(escapedUrl, 'g');
    cleanedGptResponse = cleanedGptResponse.replace(rawUrlRegex, '');
    
    // Clean up any double newlines or trailing spaces left behind
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

  // ✅ AUTO-COMPLETE: If manually finished OR GPT detected completion, trigger the completeTest logic
  if (isManualFinish || shouldComplete) {
    // Only trigger background completion if it's NOT a manual finish.
    // Manual finish returns a specific response and expects the frontend to call /complete.
    if (!isManualFinish && shouldComplete) {
      console.log(`[Conversation] Auto-completing test ${userTestId} in background...`);
      completeTest({ user, userTestId }).catch(err => {
        if (err.status === 409 || err.message === 'ALREADY_COMPLETED') {
          console.log(`[Conversation] Background auto-completion for ${userTestId} skipped: already in progress.`);
        } else {
          console.error("[Conversation] Error in background auto-completion:", err);
        }
      });
    }
    
    if (isManualFinish) {
      return {
        testAttemptId: testAttempt.id,
        gptResponse: cleanedGptResponse,
        messageCount: newMessageCount,
        isCompleted: true,
        suggestedCompletion: true,
        components: undefined
      };
    }
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
async function completeTest({ user, userTestId }) {
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
    console.log(`[CompleteTest] Test ${userTestId} already completed. Returning existing report.`);
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
      throw new Error('ALREADY_COMPLETED');
    }

    console.log(`[CompleteTest] Lock acquired for test ${userTestId}. Proceeding with evaluation.`);
  } catch (err) {
    // If update fails because of the 'where' clause or explicit error, it means it's already COMPLETED or being processed
    console.log(`[CompleteTest] Test ${userTestId} already being processed or completed. Polling for report...`);
    
    // Polling mechanism to wait for the other process to finish evaluation and create the report
    let finalUserTest;
    const maxPollAttempts = 12; // 18 seconds total
    const pollInterval = 1500; 

    for (let i = 0; i < maxPollAttempts; i++) {
      finalUserTest = await prisma.userTest.findUnique({
        where: { id: userTest.id },
        include: { report: true }
      });

      if (finalUserTest?.report) {
        console.log(`[CompleteTest] Report found for ${userTestId} after ${i + 1} polls.`);
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

  // Generate evaluation using GPT
  const conversationSummary = testAttempt.answers
    .map((a, i) => `Exchange ${i + 1}:\nUser: ${a.userMessage}\nGPT: ${a.gptResponse || 'N/A'}`)
    .join('\n\n');

  const evaluationPrompt = `You are an expert evaluator for behavioral assessments. 

Based on the following conversation, provide a comprehensive evaluation with scores:

CONVERSATION:
${conversationSummary}

Provide your evaluation in JSON format with:
{
  "overallScore": <number 0-100>,
  "creativity": <number 0-100>,
  "feasibility": <number 0-100>,
  "proactivity": <number 0-100>,
  "summary": "<detailed summary paragraph>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "improvements": ["<improvement 1>", "<improvement 2>", ...],
  "reasoning": "<brief explanation of scoring rationale>",
  "confidence": <number 0-100, how confident you are in this evaluation>
}

IMPORTANT: All scores must be integers between 0 and 100.`;

  let evaluationResult;
  let evaluationAttempts = 0;
  const maxRetries = 3;
  
  const evaluationModel = process.env.OPENAI_EVAL_MODEL || 'gpt-4o-mini';
  while (evaluationAttempts < maxRetries) {
    try {
      evaluationAttempts++;
      console.log(`[Evaluation] Attempt ${evaluationAttempts}/${maxRetries} for userTestId: ${userTestId}`);
      
      evaluationResult = await evaluateAnswer({
        model: evaluationModel,
        messages: [
          { role: 'system', content: 'You are an objective evaluator. Return only valid JSON with all required fields.' },
          { role: 'user', content: evaluationPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });
      
      // Validate and normalize scores
      evaluationResult = validateAndNormalizeEvaluation(evaluationResult);
      
      // Log successful evaluation
      console.log(`[Evaluation] Success for userTestId: ${userTestId}`, {
        overallScore: evaluationResult.overallScore,
        components: evaluationResult.creativity !== undefined ? {
          creativity: evaluationResult.creativity,
          feasibility: evaluationResult.feasibility,
          proactivity: evaluationResult.proactivity
        } : 'N/A',
        confidence: evaluationResult.confidence || 'N/A',
        messageCount: testAttempt.messageCount
      });
      
      break; // Success, exit retry loop
      
    } catch (err) {
      console.error(`[Evaluation] Attempt ${evaluationAttempts} failed:`, err.message);
      
      if (evaluationAttempts >= maxRetries) {
        // Final fallback after all retries failed
        console.warn(`[Evaluation] All ${maxRetries} attempts failed. Using fallback evaluation.`);
        evaluationResult = {
          overallScore: 75,
          creativity: 75,
          feasibility: 75,
          proactivity: 75,
          summary: 'Evaluation completed. Review conversation for detailed insights. (Note: Automated evaluation encountered issues)',
          strengths: ['Active participation', 'Clear communication'],
          improvements: ['Further detail could enhance responses'],
          reasoning: 'Fallback evaluation used due to evaluation service unavailability',
          confidence: 50
        };
      } else {
        // Wait before retry (exponential backoff)
        const waitTime = Math.pow(2, evaluationAttempts) * 1000; // 2s, 4s, 8s
        console.log(`[Evaluation] Retrying in ${waitTime}ms...`);
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
          creativity: evaluationResult.creativity,
          feasibility: evaluationResult.feasibility,
          proactivity: evaluationResult.proactivity
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
        creativity: evaluationResult.creativity,
        feasibility: evaluationResult.feasibility,
        proactivity: evaluationResult.proactivity
      },
      strengths: evaluationResult.strengths,
      improvements: evaluationResult.improvements,
      // Add evaluation metadata
      evaluationMetadata: {
        confidence: evaluationResult.confidence,
        reasoning: evaluationResult.reasoning,
        evaluatedAt: new Date().toISOString(),
        messageCount: testAttempt.messageCount,
        evaluationAttempts: evaluationAttempts,
        modelVersion: evaluationModel,
        promptVersion: (userTest.test.settings && userTest.test.settings.promptVersion) ? String(userTest.test.settings.promptVersion) : '1.0',
        scoringVersion: 'ckpi-v1'
      }
    },
    detailedAnalysis: {
      messageCount: testAttempt.messageCount,
      totalTime: totalTime,
      conversationSummary: conversationSummary.substring(0, 5000), // Limit size
      evaluationConfidence: evaluationResult.confidence,
      evaluationReasoning: evaluationResult.reasoning
    }
  };
  try {
    const summaryJson = await evaluateAnswer({
      model: process.env.OPENAI_EVAL_MODEL || 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'Return JSON with keys: problem_summary, solution_summary, problem_cluster, solution_cluster, problem_key, problem_topic, solution_key, solution_topic. ' +
                   'Keys should be stable slugs (e.g. "INTERNAL_COMM"), topics should be human-readable titles.' 
        },
        { role: 'user', content: `Summarize and categorize:\n${conversationSummary.substring(0, 6000)}` }
      ],
      temperature: 0.2,
      max_tokens: 600
    });
    if (summaryJson && typeof summaryJson === 'object') {
      reportData.detailedAnalysis.problem_summary = summaryJson.problem_summary || null;
      reportData.detailedAnalysis.solution_summary = summaryJson.solution_summary || null;
      reportData.detailedAnalysis.problem_cluster = summaryJson.problem_cluster || null;
      reportData.detailedAnalysis.solution_cluster = summaryJson.solution_cluster || null;
      // Stable keys and topics for aggregation
      reportData.detailedAnalysis.problem_key = summaryJson.problem_key || summaryJson.problem_cluster || 'UNKNOWN';
      reportData.detailedAnalysis.problem_topic = summaryJson.problem_topic || summaryJson.problem_cluster || 'Unknown Problem';
      reportData.detailedAnalysis.solution_key = summaryJson.solution_key || summaryJson.solution_cluster || 'UNKNOWN';
      reportData.detailedAnalysis.solution_topic = summaryJson.solution_topic || summaryJson.solution_cluster || 'Unknown Solution';
    }
  } catch (e) {}

  try {
    const ckpiJson = await evaluateAnswer({
      model: process.env.OPENAI_EVAL_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return JSON with integer keys: overall, simplification, originality, feasibility, criticalThinking, proactivity. Range 0-100.' },
        { role: 'user', content: conversationSummary.substring(0, 6000) }
      ],
      temperature: 0.2,
      max_tokens: 400
    });
    if (ckpiJson && typeof ckpiJson === 'object') {
      const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
      if (typeof ckpiJson.simplification === 'number') reportData.kpis.components.simplification = clamp(ckpiJson.simplification);
      if (typeof ckpiJson.originality === 'number') reportData.kpis.components.originality = clamp(ckpiJson.originality);
      if (typeof ckpiJson.criticalThinking === 'number') reportData.kpis.components.criticalThinking = clamp(ckpiJson.criticalThinking);
      if (typeof ckpiJson.feasibility === 'number') reportData.kpis.components.feasibility = clamp(ckpiJson.feasibility);
      if (typeof ckpiJson.proactivity === 'number') reportData.kpis.components.proactivity = clamp(ckpiJson.proactivity);
      if (typeof ckpiJson.overall === 'number') reportData.kpis.final = clamp(ckpiJson.overall);
    }
  } catch (e) {}

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
 * Ensures all scores are within 0-100 range and all required fields exist
 */
function validateAndNormalizeEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') {
    throw new Error('Invalid evaluation result: not an object');
  }

  // Helper to clamp score between 0-100
  const clampScore = (score, fieldName) => {
    if (typeof score !== 'number' || isNaN(score)) {
      console.warn(`[Validation] Invalid ${fieldName} score: ${score}, defaulting to 75`);
      return 75;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  };

  // Validate and normalize all scores
  const validated = {
    overallScore: clampScore(evaluation.overallScore, 'overallScore'),
    creativity: clampScore(evaluation.creativity, 'creativity'),
    feasibility: clampScore(evaluation.feasibility, 'feasibility'),
    proactivity: clampScore(evaluation.proactivity, 'proactivity'),
    summary: typeof evaluation.summary === 'string' && evaluation.summary.trim()
      ? evaluation.summary.trim()
      : 'Evaluation completed. Review conversation for detailed insights.',
    strengths: Array.isArray(evaluation.strengths) && evaluation.strengths.length > 0
      ? evaluation.strengths.filter(s => typeof s === 'string' && s.trim()).slice(0, 5)
      : ['Active participation', 'Clear communication'],
    improvements: Array.isArray(evaluation.improvements) && evaluation.improvements.length > 0
      ? evaluation.improvements.filter(i => typeof i === 'string' && i.trim()).slice(0, 5)
      : ['Further detail could enhance responses'],
    reasoning: typeof evaluation.reasoning === 'string' && evaluation.reasoning.trim()
      ? evaluation.reasoning.trim()
      : 'Evaluation based on conversation analysis',
    confidence: clampScore(evaluation.confidence || 85, 'confidence')
  };

  // Log validation warnings if any
  if (evaluation.overallScore !== validated.overallScore ||
      evaluation.creativity !== validated.creativity ||
      evaluation.feasibility !== validated.feasibility ||
      evaluation.proactivity !== validated.proactivity) {
    console.warn('[Validation] Scores were adjusted:', {
      original: {
        overallScore: evaluation.overallScore,
        creativity: evaluation.creativity,
        feasibility: evaluation.feasibility,
        proactivity: evaluation.proactivity
      },
      validated: {
        overallScore: validated.overallScore,
        creativity: validated.creativity,
        feasibility: validated.feasibility,
        proactivity: validated.proactivity
      }
    });
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

module.exports = {
  startTestConversation,
  handleUserMessage,
  completeTest
};
