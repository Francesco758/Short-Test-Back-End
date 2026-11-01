const { prisma } = require('../utils/prismaClient');

async function getTeamProblems(companyId) {
  return prisma.teamProblem.findMany({
    where: { companyId },
    orderBy: { frequency: 'desc' },
    take: 20
  });
}

async function getTeamSolutions(companyId, userId) {
  const solutions = await prisma.teamSolution.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      problem: { select: { topic: true } },
      likes: { select: { userId: true } }
    }
  });

  return solutions.map(s => ({
    id: s.id,
    key: s.key,
    topic: s.topic,
    description: s.description,
    source: s.source,
    problemTopic: s.problem?.topic || null,
    createdAt: s.createdAt,
    likes: s.likes.length,
    likedByMe: s.likes.some(l => l.userId === userId)
  }));
}

async function toggleLike(solutionId, userId) {
  const existing = await prisma.solutionLike.findUnique({
    where: { solutionId_userId: { solutionId, userId } }
  });

  if (existing) {
    await prisma.solutionLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.solutionLike.create({
      data: { solutionId, userId }
    });
  }

  const count = await prisma.solutionLike.count({ where: { solutionId } });
  return { liked: !existing, likes: count };
}

function generateClusterId(topic) {
  if (!topic) return null;
  return topic.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 100) || null;
}

async function extractFromEvaluation(evaluationResult, companyId, userId) {
  const {
    problem_key, problem_topic, problem_summary,
    problem_cluster, solution_key, solution_topic,
    solution_summary, solution_cluster
  } = evaluationResult || {};

  if (!problem_key || problem_key === 'UNKNOWN') return;

  const problem = await prisma.teamProblem.upsert({
    where: { companyId_key: { companyId, key: problem_key } },
    create: {
      companyId,
      key: problem_key,
      topic: problem_topic || 'Unknown Problem',
      description: problem_summary || problem_topic || '',
      frequency: 1,
      source: 'evaluation',
      createdById: userId,
      clusterId: generateClusterId(problem_topic),
      clusterLabel: problem_topic || null
    },
    update: {
      frequency: { increment: 1 },
      topic: problem_topic || undefined,
      description: problem_summary || undefined
    }
  });

  if (!problem.clusterId) {
    const cid = generateClusterId(problem_topic);
    if (cid) {
      await prisma.teamProblem.update({
        where: { id: problem.id },
        data: { clusterId: cid, clusterLabel: problem_topic || null }
      });
    }
  }

  if (solution_key && solution_key !== 'UNKNOWN') {
    await prisma.teamSolution.upsert({
      where: { companyId_key: { companyId, key: solution_key } },
      create: {
        companyId,
        problemId: problem.id,
        key: solution_key,
        topic: solution_topic || 'Unknown Solution',
        description: solution_summary || solution_topic || '',
        source: 'evaluation',
        createdById: userId,
        clusterId: generateClusterId(solution_topic),
        clusterLabel: solution_topic || null
      },
      update: {
        topic: solution_topic || undefined,
        description: solution_summary || undefined,
        problemId: problem.id
      }
    });
  }
}

async function startTeamTest(user, context) {
  const { brief, title } = context;

  const customTest = await prisma.test.findFirst({
    where: {
      isCustom: true,
      status: 'ACTIVE',
      OR: [
        { companyId: user.companyId },
        { companyId: null }
      ]
    }
  });

  if (!customTest) {
    throw new Error('No custom test configured for your team. Contact your admin.');
  }

  const userTest = await prisma.userTest.create({
    data: {
      userId: user.id,
      testId: customTest.id,
      companyId: user.companyId,
      status: 'IN_PROGRESS',
      brief,
      startedAt: new Date(),
      source: 'self'
    }
  });

  const testAttempt = await prisma.testAttempt.create({
    data: {
      userTestId: userTest.id,
      testId: customTest.id,
      messageCount: 0,
      isCompleted: false
    }
  });

  return {
    userTestId: userTest.id,
    testAttemptId: testAttempt.id,
    isCustom: true,
    brief,
    testTitle: title || customTest.title
  };
}

module.exports = {
  getTeamProblems,
  getTeamSolutions,
  toggleLike,
  extractFromEvaluation,
  startTeamTest
};
