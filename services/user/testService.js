const { prisma } = require('../../utils/prismaClient');
const conversationService = require('../conversationServiceSimplified');

async function getAssignedTests(userId) {
  // Get user to check if guest
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isGuest: true, companyId: true }
  });

  // Fetch regular assignments
  const assignedTests = await prisma.userTest.findMany({
    where: { userId, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] } },
    include: { 
      test: true,
      report: true,
      attempts: { 
        orderBy: { createdAt: 'desc' }, 
        take: 1,
        include: {
          answers: {
            orderBy: { createdAt: 'asc' }
          }
        }
      }
    },
    orderBy: { assignedAt: 'desc' }
  });

  // For guests: also auto-create UserTest records for guest-accessible tests
  if (user?.isGuest && user?.companyId) {
    const guestAccessible = await prisma.companyTest.findMany({
      where: { companyId: user.companyId, guestAccess: true },
      include: { test: true }
    });

    for (const ct of guestAccessible) {
      const alreadyHas = assignedTests.some(ut => ut.testId === ct.testId);
      if (!alreadyHas) {
        const newUt = await prisma.userTest.create({
          data: {
            userId: user.id,
            testId: ct.testId,
            companyId: user.companyId,
            status: 'ASSIGNED',
            assignedAt: new Date()
          },
          include: {
            test: true,
            report: true,
            attempts: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { answers: { orderBy: { createdAt: 'asc' } } }
            }
          }
        });
        assignedTests.unshift(newUt);
      }
    }
  }

  return assignedTests;
}

async function startTest(userTestId, userId) {
  const userTest = await prisma.userTest.findFirst({
    where: { id: userTestId, userId, status: 'ASSIGNED' },
    include: { test: true }
  });
  
  if (!userTest) {
    throw new Error('Test not found or already started');
  }
  
  // Create test attempt with phase 1
  const attempt = await prisma.testAttempt.create({
    data: {
      userTestId,
      testId: userTest.testId,
      currentPhase: 1,
      kpis: {},
      metadata: { startedAt: new Date().toISOString() }
    }
  });
  
  // Update user test status
  await prisma.userTest.update({
    where: { id: userTestId },
    data: { 
      status: 'IN_PROGRESS',
      startedAt: new Date()
    }
  });
  
  return { 
    attempt, 
    test: userTest.test,
    currentPhase: 1
  };
}

// Submit answer with auto-advance
async function submitAnswer({ userTestId, userId, stepIndex, optionKey, openText }) {
  const userTest = await prisma.userTest.findFirst({
    where: { 
      id: userTestId, 
      userId, 
      status: 'IN_PROGRESS' 
    },
    include: { 
      test: true, 
      attempts: { 
        orderBy: { createdAt: 'desc' }, 
        take: 1,
        include: {
          answers: {
            orderBy: { createdAt: 'asc' }
          }
        }
      } 
    }
  });
  
  if (!userTest || !userTest.attempts.length) {
    throw new Error('Test not found or not in progress');
  }
  
  const currentAttempt = userTest.attempts[0];
  const currentPhase = currentAttempt.currentPhase || 1;

  // Validate step index matches current phase
  if (stepIndex && stepIndex !== currentPhase) {
    throw new Error(`Step index ${stepIndex} does not match current phase ${currentPhase}`);
  }

  // Use conversation service for GPT interaction and auto-advance
  const result = await conversationService.handleAnswer({
    testAttempt: currentAttempt,
    stepIndex: currentPhase, // Use current phase from database
    optionKey,
    openText,
    user: { id: userId }
  });
  
  // Return complete result including GPT reply and next phase
  return {
    success: true,
    gptReply: result.gptReply,
    phase: result.phase,
    nextPhase: result.nextPhase,
    userTestId,
    currentPhase: result.nextPhase, // Return the new current phase
    rating: result.gptRating
  };
}

// Get current test status
async function getTestStatus(userTestId, userId) {
  const userTest = await prisma.userTest.findFirst({
    where: { 
      id: userTestId, 
      userId 
    },
    include: { 
      attempts: { 
        orderBy: { createdAt: 'desc' }, 
        take: 1,
        include: {
          answers: {
            orderBy: { createdAt: 'asc' }
          }
        }
      } 
    }
  });
  
  if (!userTest) {
    throw new Error('Test not found');
  }
  
  const currentAttempt = userTest.attempts[0];
  const currentPhase = currentAttempt?.currentPhase || 1;
  
  return {
    userTestId,
    status: userTest.status,
    currentPhase,
    totalPhases: 6,
    attemptId: currentAttempt?.id
  };
}

async function finishTest(userTestId, userId) {
  const userTest = await prisma.userTest.findFirst({
    where: { id: userTestId, userId, status: 'IN_PROGRESS' },
    include: { 
      attempts: { 
        orderBy: { createdAt: 'desc' }, 
        take: 1,
        include: {
          answers: {
            orderBy: { createdAt: 'asc' }
          }
        }
      } 
    }
  });
  
  if (!userTest) {
    throw new Error('Test not found or not in progress');
  }
  
  const completedAt = new Date();
  const startedAt = userTest.startedAt || completedAt;
  const totalTime = Math.round((completedAt - startedAt) / 1000); // in seconds
  
  // Generate final report
  const report = await generateFinalReport(userTestId);
  
  // Update user test
  await prisma.userTest.update({
    where: { id: userTestId },
    data: {
      status: 'COMPLETED',
      completedAt,
      totalTime,
      report: { create: report }
    }
  });
  
  return { 
    message: 'Test completed successfully', 
    report,
    userTestId,
    completedAt,
    totalTime
  };
}

async function generateFinalReport(userTestId) {
  const userTest = await prisma.userTest.findUnique({
    where: { id: userTestId },
    include: { 
      attempts: { 
        include: { 
          answers: {
            orderBy: { phase: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 1 
      },
      test: true
    }
  });
  
  if (!userTest.attempts.length) {
    throw new Error('No test attempt found');
  }
  
  const attempt = userTest.attempts[0];
  const answers = attempt.answers;
  
  // Calculate KPI based on GPT ratings
  const ratings = answers
    .map(a => a.gptRating)
    .filter(r => r !== null && r !== undefined);
  
  const finalKPI = ratings.length > 0
    ? Math.round(ratings.reduce((sum, r) => sum + r, 0) / ratings.length)
    : 50; // Default fallback
  
  const components = {
    simplification: calculateComponentAverage(answers, 'simplification'),
    originality: calculateComponentAverage(answers, 'originality') || calculateComponentAverage(answers, 'creativity'),
    feasibility: calculateComponentAverage(answers, 'feasibility'),
    criticalThinking: calculateComponentAverage(answers, 'criticalThinking'),
    proactivity: calculateComponentAverage(answers, 'proactivity'),
    impact: calculateComponentAverage(answers, 'impact')
  };
  // Compute final KPI as average of the six components when available
  const compValues = [
    components.simplification || 0,
    components.originality || 0,
    components.feasibility || 0,
    components.criticalThinking || 0,
    components.proactivity || 0,
    components.impact || 0
  ];
  const computedFinal = Math.round(compValues.reduce((s, v) => s + v, 0) / compValues.length);

  const finalValue = (compValues.some(v => v > 0)) ? computedFinal : finalKPI;

  return {
    summary: `Change KPI: ${finalValue}% - ${getKPILevel(finalValue)}`,
    kpis: {
      final: finalValue,
      components,
      method: (compValues.some(v => v > 0)) ? 'components-average' : (ratings.length > 0 ? 'gpt-average' : 'default'),
      ratingsCount: ratings.length,
      phasesCompleted: answers.length
    },
    detailedAnalysis: generateDetailedAnalysis(answers, finalValue)
  };
}

function calculateComponentAverage(answers, component) {
  const values = answers
    .map(a => a.components?.[component])
    .filter(v => v !== null && v !== undefined);
  
  return values.length > 0
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;
}

function getKPILevel(kpi) {
  if (kpi >= 80) return 'Excellent';
  if (kpi >= 60) return 'Good';
  if (kpi >= 40) return 'Average';
  return 'Needs Improvement';
}

function generateDetailedAnalysis(answers, finalKPI) {
  return {
    overallPerformance: getKPILevel(finalKPI),
    strengths: identifyStrengths(answers),
    areasForImprovement: identifyImprovements(answers),
    recommendations: generateRecommendations(finalKPI),
    phasesCompleted: answers.length
  };
}

function identifyStrengths(answers) {
  const strengths = [];
  if (answers.some(a => a.gptRating >= 80)) {
    strengths.push('Strong problem-solving skills');
  }
  if (answers.some(a => a.components?.creativity >= 80)) {
    strengths.push('Creative thinking');
  }
  if (answers.some(a => a.components?.feasibility >= 80)) {
    strengths.push('Practical implementation focus');
  }
  return strengths.length > 0 ? strengths : ['Good analytical skills'];
}

function identifyImprovements(answers) {
  const improvements = [];
  if (answers.some(a => a.gptRating <= 60)) {
    improvements.push('More detailed planning');
  }
  if (answers.some(a => a.components?.proactivity <= 60)) {
    improvements.push('Increased proactive thinking');
  }
  return improvements.length > 0 ? improvements : ['Continue developing solution approaches'];
}

function generateRecommendations(kpi) {
  if (kpi >= 80) return ['Continue current approach', 'Share best practices with team'];
  if (kpi >= 60) return ['Focus on implementation details', 'Seek feedback on solutions'];
  return ['Review problem-solving frameworks', 'Practice scenario analysis'];
}

module.exports = { 
  getAssignedTests, 
  startTest, 
  submitAnswer, 
  finishTest, 
  getTestStatus 
};