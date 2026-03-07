const { prisma } = require('../../utils/prismaClient');
const { streamChatCompletion, runChatWithTools } = require('../gptService');

async function getUserReports(companyId) {
  return prisma.report.findMany({
    where: { userTest: { companyId } },
    include: {
      userTest: { 
        include: { 
          user: true, 
          test: true,
          attempts: { include: { answers: true } }
        } 
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async function getUserTestReport(userTestId, companyId) {
  return prisma.report.findFirst({
    where: { userTestId, userTest: { companyId } },
    include: {
      userTest: { 
        include: { 
          user: true, 
          test: true,
          attempts: { 
            include: { answers: true },
            orderBy: { createdAt: 'desc' }
          }
        } 
      }
    }
  });
}

async function getCompanyStats(companyId) {
  const [userCount, testCount, completedTests, reports] = await Promise.all([
    prisma.user.count({ where: { companyId, deletedAt: null } }),
    prisma.userTest.count({ where: { companyId } }),
    prisma.userTest.count({ where: { companyId, status: 'COMPLETED' } }),
    prisma.report.findMany({
      where: { userTest: { companyId, status: 'COMPLETED' } },
      include: { 
        userTest: { 
          include: { user: true } 
        } 
      }
    })
  ]);
  
  const avgKPI = reports.length > 0
    ? reports.reduce((sum, r) => sum + (r.kpis?.final || 0), 0) / reports.length
    : 0;
  
  const avgTime = reports.length > 0
    ? reports.reduce((sum, r) => sum + (r.userTest.totalTime || 0), 0) / reports.length
    : 0;

  // Get Top Shorters
  const userStats = {};
  reports.forEach(r => {
    const userId = r.userTest.userId;
    if (!userStats[userId]) {
      userStats[userId] = { 
        id: userId, 
        name: r.userTest.user?.name || r.userTest.user?.email || `User ${userId}`, 
        totalScore: 0, 
        count: 0 
      };
    }
    userStats[userId].totalScore += (r.kpis?.final || 0);
    userStats[userId].count += 1;
  });

  const topShorters = Object.values(userStats)
    .map(u => ({
      id: u.id,
      name: u.name,
      avgCKPI: Math.round(u.totalScore / u.count)
    }))
    .sort((a, b) => b.avgCKPI - a.avgCKPI);
  
  return {
    userCount,
    testCount,
    completedTests,
    completionRate: testCount > 0 ? (completedTests / testCount) * 100 : 0,
    avgKPI: Math.round(avgKPI),
    avgTime: Math.round(avgTime / 60), // Convert to minutes
    topShorters
  };
}

/**
 * Problem-solution overview for company manager view
 * Similar to admin version but company-specific
 */
async function getProblemSolutionOverview(companyId, { from = null, to = null, limit = 10 } = {}) {
  const whereReport = { userTest: { companyId } };
  const reports = await prisma.report.findMany({
    where: whereReport,
    include: { userTest: { include: { user: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  
  const filtered = reports.filter(r => {
    const ts = new Date(r.createdAt).getTime();
    const after = from ? ts >= from.getTime() : true;
    const before = to ? ts <= to.getTime() : true;
    return after && before;
  });
  
  const aggProblems = {};
  const aggSolutions = {};
  const pairs = {};
  
  // Analytics for new questions
  const problemsByMonth = {};
  const solutionsByMonth = {};
  const problemsByRole = {};
  
  filtered.forEach(r => {
    const kpis = r.kpis || {};
    const comp = kpis.components || {};
    const final = kpis.final || 0;
    const da = r.detailedAnalysis || {};
    const role = r.userTest?.user?.role || 'Unknown';
    const month = new Date(r.createdAt).toISOString().substring(0, 7);

    // Use stable keys/topics if available, fallback to clusters
    const pKey = da.problem_key || da.problem_cluster || null;
    const pTopic = da.problem_topic || da.problem_cluster || null;
    const sKey = da.solution_key || da.solution_cluster || null;
    const sTopic = da.solution_topic || da.solution_cluster || null;
    
    if (pKey) {
      const a = aggProblems[pKey] || { count: 0, sumFinal: 0, topic: pTopic };
      a.count += 1;
      a.sumFinal += final;
      aggProblems[pKey] = a;

      // Track by month
      if (!problemsByMonth[month]) problemsByMonth[month] = {};
      problemsByMonth[month][pTopic] = (problemsByMonth[month][pTopic] || 0) + 1;

      // Track by role
      if (!problemsByRole[role]) problemsByRole[role] = {};
      problemsByRole[role][pTopic] = (problemsByRole[role][pTopic] || 0) + 1;
    }
    
    if (sKey) {
      const a = aggSolutions[sKey] || { 
        count: 0, 
        sumFinal: 0, 
        sumFeas: 0, 
        sumProact: 0, 
        topic: sTopic,
        bestExample: null,
        maxFeas: -1
      };
      a.count += 1;
      a.sumFinal += final;
      const feas = typeof comp.feasibility === 'number' ? comp.feasibility : 0;
      a.sumFeas += feas;
      a.sumProact += typeof comp.proactivity === 'number' ? comp.proactivity : 0;

      // Track by month
      if (!solutionsByMonth[month]) solutionsByMonth[month] = {};
      solutionsByMonth[month][sTopic] = (solutionsByMonth[month][sTopic] || 0) + 1;
      
      // Capture best example summary (highest feasibility)
      if (feas > a.maxFeas || !a.bestExample) {
        a.maxFeas = feas;
        a.bestExample = da.solution_summary || r.summary || null;
      }
      
      aggSolutions[sKey] = a;
    }
    
    if (pKey && sKey) {
      const matrixKey = `${pKey}__${sKey}`;
      const a = pairs[matrixKey] || { count: 0, sumFinal: 0, pTopic, sTopic };
      a.count += 1;
      a.sumFinal += final;
      pairs[matrixKey] = a;
    }
  });

  const problems = Object.entries(aggProblems)
    .map(([key, v]) => ({ 
      key, 
      cluster: v.topic, 
      count: v.count, 
      avgFinal: Math.round(v.sumFinal / v.count) 
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const solutions = Object.entries(aggSolutions)
    .map(([key, v]) => ({
      key,
      cluster: v.topic,
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      avgFeasibility: Math.round(v.sumFeas / v.count),
      avgProactivity: Math.round(v.sumProact / v.count),
      bestExample: v.bestExample
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  // Get 10 most recent problem summaries
  const recentProblems = filtered
    .filter(r => r.detailedAnalysis?.problem_summary)
    .slice(0, 10)
    .map(r => ({
      id: r.id,
      summary: r.detailedAnalysis.problem_summary,
      cluster: r.detailedAnalysis.problem_topic || r.detailedAnalysis.problem_cluster || 'Uncategorized',
      date: r.createdAt
    }));
    
  return { 
    problems, 
    solutions, 
    recentProblems,
    totalReports: filtered.length,
    problemsByMonth,
    problemsByRole,
    solutionsByMonth
  };
}

async function queryCompanyData(companyId, question) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });

  const users = await prisma.user.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true, email: true, role: true, lastLoginAt: true }
  });

  const companyTests = await prisma.companyTest.findMany({
    where: { companyId },
    include: { test: { select: { id: true, title: true, status: true } } }
  });

  const assignments = await prisma.userTest.findMany({
    where: { companyId },
    select: {
      id: true,
      userId: true,
      testId: true,
      status: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true,
      report: { select: { kpis: true } }
    }
  });

  const psOverview = await getProblemSolutionOverview(companyId, { limit: 20 });
  const summary = buildSummary(users, companyTests, assignments, psOverview);

  const system = `You are a data analytics assistant for the company "${company?.name || 'Unknown'}".
Use ONLY the provided dataset to answer the manager's question.
If information is missing, say so clearly.
Return a concise, actionable answer in Markdown (lists or tables when useful).
You can generate charts or images when they would help visualize the data.`;

  const dataBlock = JSON.stringify(summary).slice(0, 25000);
  const content = `Dataset:\n\n${dataBlock}`;

  try {
    // Use enhanced GPT service with tools for chart/image generation
    const { content: answer, toolOutputs } = await runChatWithTools({
      model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `${content}\n\nQuestion: ${question}` }
      ],
      temperature: 0.2
    });

    // Extract visual components from tool outputs
    let chartSpec = null;
    let imageUrl = null;
    let imageSize = null;

    if (toolOutputs) {
      for (const toolOutput of toolOutputs) {
        if (toolOutput.name === 'generate_chart_spec' && toolOutput.output) {
          chartSpec = toolOutput.output;
        }
        if (toolOutput.name === 'generate_image' && toolOutput.output?.url) {
          imageUrl = toolOutput.output.url;
          imageSize = toolOutput.output.size;
        }
      }
    }

    return {
      answer,
      chartSpec,
      imageUrl,
      imageSize
    };
  } catch (error) {
    // Fallback to simple text response if tools fail
    console.warn('Enhanced GPT service failed, falling back to simple response:', error);
    
    return new Promise((resolve, reject) => {
      let answer = '';
      streamChatCompletion({
        model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${content}\n\nQuestion: ${question}` }
        ],
        temperature: 0.2,
        onChunk: (chunk) => { answer += chunk; },
        onDone: () => resolve({ answer }),
        onError: (err) => reject(err)
      });
    });
  }
}

function buildSummary(users, companyTests, assignments, psOverview = null) {
  const userMap = Object.fromEntries(users.map(u => [u.id, { name: u.name || u.email, role: u.role }]));
  const testMap = Object.fromEntries(companyTests.map(ct => [ct.test.id, { title: ct.test.title, status: ct.test.status }]));
  const metrics = { count: assignments.length, completed: 0, inProgress: 0, assigned: 0, avgFinal: null };
  const finals = [];
  
  const rows = assignments.map(a => {
    const final = a.report?.kpis?.final ?? null;
    if (final != null) finals.push(final);
    if (a.status === 'COMPLETED') metrics.completed++; else if (a.status === 'IN_PROGRESS') metrics.inProgress++; else if (a.status === 'ASSIGNED') metrics.assigned++;
    return {
      user: userMap[a.userId]?.name || a.userId,
      role: userMap[a.userId]?.role || 'USER',
      test: testMap[a.testId]?.title || a.testId,
      status: a.status,
      score: final,
      completedAt: a.completedAt
    };
  });

  // Calculate monthly CKPI evolution
  const monthlyCKPI = {};
  assignments.filter(a => a.status === 'COMPLETED' && a.report?.kpis?.final && a.completedAt).forEach(a => {
    const month = new Date(a.completedAt).toISOString().substring(0, 7); // YYYY-MM
    if (!monthlyCKPI[month]) monthlyCKPI[month] = { sum: 0, count: 0 };
    monthlyCKPI[month].sum += a.report.kpis.final;
    monthlyCKPI[month].count += 1;
  });

  const evolution = Object.entries(monthlyCKPI)
    .map(([month, data]) => ({ month, avgScore: Math.round(data.sum / data.count) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  if (finals.length) metrics.avgFinal = Math.round(finals.reduce((s, v) => s + v, 0) / finals.length);

  return {
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role })),
    tests: companyTests.map(ct => ({ id: ct.test.id, title: ct.test.title, status: ct.test.status })),
    assignments: rows,
    metrics,
    ckpiEvolution: evolution,
    problemSolutionOverview: psOverview
  };
}

/**
 * Upcoming deadlines for manager view
 */
async function getUpcomingDeadlines(companyId) {
  return prisma.userTest.findMany({
    where: {
      companyId,
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
      deadline: { not: null }
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      test: { select: { id: true, title: true } }
    },
    orderBy: { deadline: 'asc' }
  });
}

/**
 * CKPI metrics with component-level trends for company manager
 */
async function getCompanyCKPIMetrics(companyId) {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Get all reports for this company
  const allReports = await prisma.report.findMany({
    where: { 
      userTest: { companyId, status: 'COMPLETED' }
    },
    orderBy: { createdAt: 'desc' }
  });

  const currentMonthReports = allReports.filter(r => new Date(r.createdAt) >= currentMonth);
  const lastMonthReports = allReports.filter(r => 
    new Date(r.createdAt) >= lastMonth && new Date(r.createdAt) < currentMonth
  );

  // Helper to calculate component averages
  const getComponentAverages = (reports) => {
    if (!reports.length) return { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 };
    const sums = reports.reduce((acc, r) => {
      const comps = r.kpis?.components || {};
      acc.simplification += comps.simplification || 0;
      acc.originality += comps.originality || 0;
      acc.feasibility += comps.feasibility || 0;
      acc.criticalThinking += comps.criticalThinking || 0;
      acc.proactivity += comps.proactivity || 0;
      return acc;
    }, { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0 });
    
    return {
      simplification: Math.round(sums.simplification / reports.length),
      originality: Math.round(sums.originality / reports.length),
      feasibility: Math.round(sums.feasibility / reports.length),
      criticalThinking: Math.round(sums.criticalThinking / reports.length),
      proactivity: Math.round(sums.proactivity / reports.length)
    };
  };

  const currentComps = getComponentAverages(currentMonthReports);
  const lastComps = getComponentAverages(lastMonthReports);
  const companyComps = getComponentAverages(allReports);

  const getTrendValue = (curr, prev) => {
    if (prev > 0) return Math.round(((curr - prev) / prev) * 100);
    if (curr > 0) return 100;
    return 0;
  };

  const componentTrends = {
    simplification: getTrendValue(currentComps.simplification, lastComps.simplification),
    originality: getTrendValue(currentComps.originality, lastComps.originality),
    feasibility: getTrendValue(currentComps.feasibility, lastComps.feasibility),
    criticalThinking: getTrendValue(currentComps.criticalThinking, lastComps.criticalThinking),
    proactivity: getTrendValue(currentComps.proactivity, lastComps.proactivity)
  };

  const currentMonthAverage = currentMonthReports.length > 0 
    ? Math.round(currentMonthReports.reduce((sum, r) => sum + (r.kpis?.final || 0), 0) / currentMonthReports.length)
    : 0;
  
  const lastMonthAverage = lastMonthReports.length > 0
    ? Math.round(lastMonthReports.reduce((sum, r) => sum + (r.kpis?.final || 0), 0) / lastMonthReports.length)
    : 0;

  const trend = lastMonthAverage > 0 
    ? Math.round(((currentMonthAverage - lastMonthAverage) / lastMonthAverage) * 100)
    : 0;

  return {
    averages: companyComps,
    componentTrends,
    totalReports: allReports.length,
    trend,
    lastUpdated: new Date().toLocaleString()
  };
}

module.exports = { 
  getUserReports, 
  getUserTestReport, 
  getCompanyStats,
  getProblemSolutionOverview,
  queryCompanyData,
  getUpcomingDeadlines,
  getCompanyCKPIMetrics
};