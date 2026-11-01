const { prisma } = require('../../utils/prismaClient');
const conversationService = require('../conversationServiceSimplified');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');
const { normalizeLaunchSource, normalizeLaunchContext } = require('../../utils/helpers');

async function getAssignedTests(userId) {
  // Same behaviour for employees and guests: guests get no auto-created
  // assignments. They start any active company shorTest from the self-serve
  // "Start a shorTest" flow (see getAvailableStandardTests below), so nothing
  // shows up as pending until they actually launch one.
  return prisma.userTest.findMany({
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
}

// ==================== SELF-SERVE STANDARD shorTESTS ====================
// An employee (or guest) can start a standard shorTest on their own, without a
// manager assigning it first. Standard shorTests are the company's non-custom
// ACTIVE tests — the custom test used by the team problems/solutions flow is
// deliberately excluded.
// Anti-abuse rule: at most PENDING_TEST_LIMIT incomplete tests per user;
// completing any one of them frees a slot. "Pending" uses the same definition
// as the dashboard (anything that is not COMPLETED).

const PENDING_TEST_LIMIT = 5;
const PENDING_TEST_STATUSES = ['ASSIGNED', 'IN_PROGRESS'];

function summarizePending(userTests) {
  const pendingCount = userTests.filter(t => PENDING_TEST_STATUSES.includes(t.status)).length;
  return {
    pendingCount,
    pendingLimit: PENDING_TEST_LIMIT,
    canStartNew: pendingCount < PENDING_TEST_LIMIT
  };
}

/**
 * List the standard shorTests the current user may start, with per-test state
 * and the pending-test gate.
 * - Users: every non-custom ACTIVE test assigned to their company.
 * - Guests: only the tests the company opened to guests (existing behaviour).
 */
async function getAvailableStandardTests(user) {
  if (!user?.companyId) {
    return { tests: [], ...summarizePending([]) };
  }

  // Identical for employees and guests: every non-custom ACTIVE test assigned
  // to the company. Guests are already gated at login (Company.guestMode), so
  // no per-test filter is needed here.
  const companyTestWhere = {
    companyId: user.companyId,
    test: { isCustom: false, status: 'ACTIVE', deletedAt: null }
  };

  const [companyTests, userTests] = await Promise.all([
    prisma.companyTest.findMany({
      where: companyTestWhere,
      include: {
        test: {
          select: { id: true, title: true, description: true, settings: true }
        }
      },
      orderBy: { assignedAt: 'desc' }
    }),
    prisma.userTest.findMany({
      where: { userId: user.id },
      select: { id: true, testId: true, status: true, assignedAt: true, startedAt: true, completedAt: true },
      orderBy: { assignedAt: 'desc' }
    })
  ]);

  const tests = companyTests.map((companyTest) => {
    const mine = userTests.filter(ut => ut.testId === companyTest.test.id);
    const pending = mine.filter(ut => PENDING_TEST_STATUSES.includes(ut.status));
    const inProgress = pending.find(ut => ut.status === 'IN_PROGRESS') || null;
    const completedCount = mine.filter(ut => ut.status === 'COMPLETED').length;
    const resumable = inProgress || pending[0] || null;

    const state = inProgress
      ? 'IN_PROGRESS'
      : (pending.length ? 'PENDING' : (completedCount ? 'COMPLETED' : 'NOT_STARTED'));

    return {
      testId: companyTest.test.id,
      title: companyTest.test.title,
      description: companyTest.test.description,
      estimatedDuration: companyTest.test.settings?.estimatedDuration || null,
      state,
      pendingCount: pending.length,
      completedCount,
      resumeUserTestId: resumable ? resumable.id : null
    };
  });

  return { tests, ...summarizePending(userTests) };
}

/**
 * Start a brand new standard shorTest for the current user.
 * Creates a fresh UserTest (a new attempt); the existing conversation endpoints
 * (`POST /api/conversation/start`) then pick it up unchanged, so completion,
 * evaluation, report generation and company data aggregation are untouched.
 */
async function launchStandardTest({ user, testId = null, source = null, context = null }) {
  if (!user?.companyId) {
    throw new ValidationError('You need to belong to a company to start a shorTest');
  }

  const available = await getAvailableStandardTests(user);

  if (!available.tests.length) {
    throw new NotFoundError('No shorTest is available for you yet. Please contact your admin.');
  }

  let target = null;

  if (testId !== undefined && testId !== null && String(testId).trim() !== '') {
    const parsedTestId = parseInt(testId, 10);
    if (Number.isNaN(parsedTestId)) {
      throw new ValidationError('testId must be a number');
    }

    target = available.tests.find(t => t.testId === parsedTestId) || null;
    if (!target) {
      throw new NotFoundError('This shorTest is not available for your company');
    }
  } else if (available.tests.length === 1) {
    // Most companies have a single shorTest: no selection needed.
    target = available.tests[0];
  } else {
    const error = new ValidationError('Several shorTests are available. Please choose one.');
    error.details = {
      tests: available.tests.map(t => ({ testId: t.testId, title: t.title }))
    };
    throw error;
  }

  // Cap check and creation run inside one transaction so a double click cannot
  // slip past the pending limit.
  const created = await prisma.$transaction(async (tx) => {
    const pendingCount = await tx.userTest.count({
      where: { userId: user.id, status: { in: PENDING_TEST_STATUSES } }
    });

    if (pendingCount >= PENDING_TEST_LIMIT) {
      // NOTE: the code must not start with "P" — the error handler treats
      // "P*" codes as Prisma error codes.
      throw new ConflictError(
        `You already have ${PENDING_TEST_LIMIT} pending tests. Complete at least one to start a new shorTest.`,
        'TOO_MANY_PENDING_TESTS'
      );
    }

    return tx.userTest.create({
      data: {
        userId: user.id,
        testId: target.testId,
        companyId: user.companyId,
        status: 'ASSIGNED',
        assignedAt: new Date(),
        source: 'self'
      }
    });
  });

  return {
    userTestId: created.id,
    testId: target.testId,
    title: target.title,
    pendingCount: available.pendingCount + 1,
    pendingLimit: available.pendingLimit,
    source: normalizeLaunchSource(source),
    context: normalizeLaunchContext(context)
  };
}

async function startTest(userTestId, userId) {
  const userTest = await prisma.userTest.findFirst({
    where: { id: userTestId, userId, status: 'ASSIGNED' },
    include: { test: true }
  });
  
  if (!userTest) {
    throw new Error('Test not found or already started');
  }

  // Guests may only take tests while their company's guest mode is on
  // (deactivation flips Company.guestMode off, which must immediately stop any
  // still-logged-in guest from starting or resuming).
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true, companyId: true }
  });
  if (owner?.isGuest) {
    const company = await prisma.company.findUnique({
      where: { id: owner.companyId },
      select: { guestMode: true }
    });
    if (company?.guestMode !== true) {
      throw new ValidationError('Guest access is no longer enabled for this company');
    }
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
  getTestStatus,
  getAvailableStandardTests,
  launchStandardTest
};