const { prisma } = require('../../utils/prismaClient');
const { calculateAverageKPI } = require('../../utils/helpers');

async function getDashboardStats() {
  const [
    totalCompanies,
    totalUsers,
    totalTests,
    totalReports,
    recentRegistrations,
    companyPerformance
  ] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.test.count({ where: { deletedAt: null } }),
    prisma.report.count(),
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { company: true }
    }),
    prisma.company.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { users: true, userTests: true } },
        userTests: { 
          where: { status: 'COMPLETED' },
          include: { report: true }
        }
      }
    })
  ]);
  
  return {
    totals: { totalCompanies, totalUsers, totalTests, totalReports },
    recentRegistrations,
    companyPerformance: companyPerformance.map(company => ({
      id: company.id,
      name: company.name,
      userCount: company._count.users,
      testCount: company._count.userTests,
      avgKPI: company.userTests.length > 0 
        ? company.userTests.reduce((sum, ut) => sum + (ut.report?.kpis?.final || 0), 0) / company.userTests.length
        : 0
    }))
  };
}

async function getRecentActivity(limit = 10) {
  return prisma.userTest.findMany({
    where: { status: 'COMPLETED' },
    include: {
      user: { include: { company: true } },
      test: true,
      report: true
    },
    orderBy: { completedAt: 'desc' },
    take: limit
  });
}

async function getCompanyPerformance() {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null },
    include: {
      userTests: {
        where: { status: 'COMPLETED' },
        include: { report: true }
      },
      _count: { select: { users: true } }
    }
  });
  
  return companies.map(company => ({
    id: company.id,
    name: company.name,
    userCount: company._count.users,
    completedTests: company.userTests.length,
    avgKPI: company.userTests.length > 0
      ? company.userTests.reduce((sum, ut) => sum + (ut.report?.kpis?.final || 0), 0) / company.userTests.length
      : 0,
    avgTime: company.userTests.length > 0
      ? company.userTests.reduce((sum, ut) => sum + (ut.totalTime || 0), 0) / company.userTests.length
      : 0
  }));
}

async function getGlobalCKPIMetrics() {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  // Get all reports for global average
  const allReports = await prisma.report.findMany({
    where: { 
      userTest: { status: 'COMPLETED' }
    },
    include: { userTest: true },
    orderBy: { createdAt: 'desc' }
  });

  // Current month reports
  const currentMonthReports = allReports.filter(r => 
    new Date(r.createdAt) >= currentMonth
  );

  // Last month reports
  const lastMonthReports = allReports.filter(r => 
    new Date(r.createdAt) >= lastMonth && new Date(r.createdAt) < currentMonth
  );

  // Calculate averages
  const globalAverageCKPI = calculateAverageKPI(allReports);
  const currentMonthAverage = calculateAverageKPI(currentMonthReports);
  const lastMonthAverage = calculateAverageKPI(lastMonthReports);

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
  const globalComps = getComponentAverages(allReports);

  // Helper to calculate trend value
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

  // Calculate trend (month-over-month change)
  const trend = lastMonthAverage > 0 
    ? Math.round(((currentMonthAverage - lastMonthAverage) / lastMonthAverage) * 100)
    : 0;

  // Get cross-company recurring problems and solutions (global view)
  const globalProblemSolution = await getProblemSolutionOverview({ companyId: null });

  return {
    globalAverageCKPI,
    currentMonthAverage,
    lastMonthAverage,
    trend,
    averages: globalComps,
    componentTrends,
    totalReports: allReports.length,
    currentMonthReports: currentMonthReports.length,
    lastMonthReports: lastMonthReports.length,
    globalProblems: globalProblemSolution.problems.slice(0, 5),
    globalSolutions: globalProblemSolution.solutions.slice(0, 5),
    lastUpdated: new Date().toLocaleString()
  };
}

async function getGlobalCKPITrend(days = 30) {
  const now = new Date();
  const startDate = new Date();
  startDate.setDate(now.getDate() - days);

  const reports = await prisma.report.findMany({
    where: {
      createdAt: { gte: startDate },
      userTest: { status: 'COMPLETED' }
    },
    select: {
      createdAt: true,
      kpis: true
    },
    orderBy: { createdAt: 'asc' }
  });

  // Group by date
  const dailyData = {};
  
  // Initialize all days in range
  for (let i = 0; i <= days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    dailyData[dateStr] = { sum: 0, count: 0 };
  }

  reports.forEach(r => {
    const dateStr = new Date(r.createdAt).toISOString().split('T')[0];
    if (dailyData[dateStr]) {
      dailyData[dateStr].sum += r.kpis?.final || 0;
      dailyData[dateStr].count += 1;
    }
  });

  const labels = [];
  const data = [];

  Object.entries(dailyData).forEach(([date, val]) => {
    const d = new Date(date);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    data.push(val.count > 0 ? Math.round(val.sum / val.count) : 0);
  });

  // If there are gaps (0 values), we can either leave them or do a running average
  // For trend visualization, 0 might look like a sharp drop. 
  // Let's implement a simple smoothing/interpolation if needed, but for now, raw daily averages.
  // Actually, if a day has 0 reports, it's better to use the previous day's average for the line chart.
  let lastVal = 0;
  const smoothedData = data.map(v => {
    if (v === 0 && lastVal > 0) return lastVal;
    if (v > 0) lastVal = v;
    return v;
  });

  return { labels, data: smoothedData };
}

module.exports = { getDashboardStats, getRecentActivity, getCompanyPerformance, getGlobalCKPIMetrics, querySystemData, getGlobalCKPITrend };

const { streamChatCompletion, runChatWithTools } = require('../gptService');

async function querySystemData(question) {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, description: true, isActive: true, createdAt: true }
  });

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, role: true, companyId: true, function: true, seniorityBand: true, createdAt: true, lastLoginAt: true }
  });

  const tests = await prisma.test.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, status: true, isCustom: true, companyId: true, createdById: true }
  });

  const assignments = await prisma.userTest.findMany({
    select: {
      id: true,
      userId: true,
      testId: true,
      companyId: true,
      status: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true,
      totalTime: true,
      report: { select: { kpis: true } }
    }
  });

  const psOverview = await getProblemSolutionOverview({ companyId: null, limit: 20 });
  const summary = buildSystemSummary(companies, users, tests, assignments, psOverview);

  const system = `You are a Global Data Assistant for the RPLT platform.
Your purpose is to provide insights into platform-wide patterns, aggregated trends, and system-level performance.
You DO NOT have access to individual company names, user identities, or specific organizational structures for privacy reasons.
Use ONLY the provided anonymized dataset to answer the question.
If information is missing or restricted, explain that you only provide aggregated global insights.
Return a concise, actionable answer in Markdown.
You can generate charts or images when they would help visualize the global trends.`;

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

function buildSystemSummary(companies, users, tests, assignments, psOverview = null) {
  const metrics = { 
    totalCompanies: companies.length, 
    totalUsers: users.length, 
    totalTests: tests.length, 
    totalAssignments: assignments.length, 
    completed: 0, 
    inProgress: 0, 
    avgFinal: null 
  };
  
  const finals = [];
  const rows = assignments.map(a => {
    const final = a.report?.kpis?.final ?? null;
    if (final != null) finals.push(final);
    if (a.status === 'COMPLETED') metrics.completed++; else if (a.status === 'IN_PROGRESS') metrics.inProgress++;
    
    // Anonymized row for global patterns analysis
    return {
      companyType: 'ANONYMOUS_ORG', // Privacy: Remove specific company names
      userRole: 'ANONYMOUS_USER', // Privacy: Remove user names/emails
      function: 'HIDDEN', // Privacy: Remove specific functions
      seniority: 'HIDDEN', // Privacy: Remove seniority
      testType: 'STANDARDIZED_ASSESSMENT',
      status: a.status,
      score: final,
      totalTimeMin: a.totalTime ? Math.round(a.totalTime / 60) : null
    };
  });
  
  if (finals.length) metrics.avgFinal = Math.round(finals.reduce((s, v) => s + v, 0) / finals.length);

  return {
    metrics,
    aggregatedPatterns: rows.slice(0, 200), // Limit rows for context window and focus on patterns
    problemSolutionOverview: psOverview
  };
}

async function getProblemSolutionOverview({ companyId = null, from = null, to = null, limit = 10 }) {
  const whereReport = companyId ? { userTest: { companyId } } : {};
  const reports = await prisma.report.findMany({
    where: whereReport,
    include: { userTest: true },
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
  filtered.forEach(r => {
    const kpis = r.kpis || {};
    const comp = kpis.components || {};
    const final = kpis.final || 0;
    const da = r.detailedAnalysis || {};
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
    }
    
    if (sKey) {
      const a = aggSolutions[sKey] || { count: 0, sumFinal: 0, sumFeas: 0, sumProact: 0, topic: sTopic };
      a.count += 1;
      a.sumFinal += final;
      a.sumFeas += typeof comp.feasibility === 'number' ? comp.feasibility : 0;
      a.sumProact += typeof comp.proactivity === 'number' ? comp.proactivity : 0;
      aggSolutions[sKey] = a;
    }
    
    if (pKey && sKey) {
      const matrixKey = `${pKey}__${sKey}`;
      const a = pairs[matrixKey] || { count: 0, sumFinal: 0, pTopic, sTopic, pKey, sKey };
      a.count += 1;
      a.sumFinal += final;
      pairs[matrixKey] = a;
    }
  });
  const problems = Object.entries(aggProblems)
    .map(([key, v]) => ({ 
      key, 
      cluster: v.topic, // Maintain backward compatibility with "cluster" field name in frontend
      count: v.count, 
      avgFinal: Math.round(v.sumFinal / v.count) 
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  const solutions = Object.entries(aggSolutions)
    .map(([key, v]) => ({
      key,
      cluster: v.topic, // Maintain backward compatibility with "cluster" field name in frontend
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      avgFeasibility: Math.round(v.sumFeas / v.count),
      avgProactivity: Math.round(v.sumProact / v.count)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  const matrix = Object.entries(pairs)
    .map(([key, v]) => {
      return { 
        problem: v.pTopic, 
        solution: v.sTopic, 
        problemKey: v.pKey,
        solutionKey: v.sKey,
        count: v.count, 
        avgFinal: Math.round(v.sumFinal / v.count) 
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit * 3);
  return { problems, solutions, matrix, totalReports: filtered.length };
}

module.exports.getProblemSolutionOverview = getProblemSolutionOverview;
