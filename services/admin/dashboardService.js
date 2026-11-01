const { prisma } = require('../../utils/prismaClient');
const { calculateAverageKPI } = require('../../utils/helpers');

const AGE_RANGES = {
  '18-30': { min: 18, max: 30 },
  '31-45': { min: 31, max: 45 },
  '46-55': { min: 46, max: 55 },
  '56-65': { min: 56, max: 65 },
  '66+':   { min: 66, max: 120 }
};

const PERIOD_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

const ORG_SIZE_RANGES = {
  '1-10':     { min: 1, max: 10 },
  '11-50':    { min: 11, max: 50 },
  '51-200':   { min: 51, max: 200 },
  '201-1000': { min: 201, max: 1000 },
  '1000+':    { min: 1001, max: 999999 }
};

function computeAge(dob) {
  const now = new Date();
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

async function getUserIdsByAge(ageRanges) {
  const users = await prisma.user.findMany({
    where: { dateOfBirth: { not: null }, deletedAt: null },
    select: { id: true, dateOfBirth: true }
  });
  return users
    .filter(u => {
      const age = computeAge(u.dateOfBirth);
      return ageRanges.some(r => {
        const range = AGE_RANGES[r];
        return range && age >= range.min && age <= range.max;
      });
    })
    .map(u => u.id);
}

async function getCompanyIdsBySize(sizeRanges) {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null, organizationSize: { not: null } },
    select: { id: true, organizationSize: true }
  });
  return companies
    .filter(c => sizeRanges.includes(c.organizationSize))
    .map(c => c.id);
}

function buildReportWhere(filters = {}) {
  const where = { userTest: { status: 'COMPLETED' } };

  if (filters.period && filters.period !== 'all') {
    const months = PERIOD_MONTHS[filters.period] || 6;
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
    where.createdAt = { gte: startDate };
  }

  if (filters.functions && filters.functions.length > 0) {
    where.userTest.user = { function: { in: filters.functions } };
  }

  if (filters.orgTypes && filters.orgTypes.length > 0) {
    where.userTest.company = { organizationType: { in: filters.orgTypes } };
  }

  return where;
}

async function applyAsyncFilters(where, filters) {
  if (filters.ages && filters.ages.length > 0) {
    const userIds = await getUserIdsByAge(filters.ages);
    if (userIds.length === 0) {
      where.userTest.userId = { in: [] };
    } else {
      where.userTest.userId = { in: userIds };
    }
  }

  if (filters.orgSizes && filters.orgSizes.length > 0) {
    const companyIds = await getCompanyIdsBySize(filters.orgSizes);
    if (companyIds.length === 0) {
      where.userTest.companyId = { in: [] };
    } else {
      where.userTest.companyId = { in: companyIds };
    }
  }

  return where;
}

async function getDashboardStats(filters = {}) {
  const hasFilters = (filters.ages && filters.ages.length) || (filters.functions && filters.functions.length) ||
    (filters.orgSizes && filters.orgSizes.length) || (filters.orgTypes && filters.orgTypes.length) || filters.period;

  const reportWhere = hasFilters ? await applyAsyncFilters(buildReportWhere(filters), filters) : {};

  const utWhereForStats = { status: 'COMPLETED' };
  if (hasFilters) {
    if (reportWhere.userTest?.user) utWhereForStats.user = reportWhere.userTest.user;
    if (reportWhere.userTest?.company) utWhereForStats.company = reportWhere.userTest.company;
    if (reportWhere.userTest?.userId) utWhereForStats.userId = reportWhere.userTest.userId;
    if (reportWhere.userTest?.companyId) utWhereForStats.companyId = reportWhere.userTest.companyId;
    if (reportWhere.createdAt) utWhereForStats.completedAt = reportWhere.createdAt;
  }

  const [
    totalCompanies,
    totalUsers,
    totalReports,
    recentRegistrations,
    companyPerformance,
    completedTests,
    peopleBreakdown,
    orgBreakdown,
    countryBreakdown,
    distinctTestTakers
  ] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
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
          where: utWhereForStats,
          include: { report: true }
        }
      }
    }),
    prisma.userTest.count({ where: utWhereForStats }),
    prisma.user.groupBy({
      by: ['role'],
      _count: true,
      where: { deletedAt: null }
    }),
    prisma.company.groupBy({
      by: ['organizationType'],
      _count: true,
      where: { deletedAt: null }
    }),
    prisma.company.groupBy({
      by: ['country'],
      _count: true,
      where: { deletedAt: null, country: { not: null } }
    }),
    prisma.userTest.groupBy({
      by: ['userId'],
      where: hasFilters ? utWhereForStats : {}
    })
  ]);

  const roleLabels = {
    SUPER_ADMIN: 'Super Admins',
    COMPANY_ADMIN: 'Managers',
    USER: 'Employees',
    STUDENT: 'Students',
    TEACHER: 'Teachers',
    GUEST: 'Guests'
  };

  const orgTypeLabels = {
    COMPANY: 'Company',
    TEAM: 'Team',
    UNIVERSITY: 'University',
    CLASSROOM: 'Classroom'
  };

  const peopleBreakdownFormatted = peopleBreakdown
    .filter(r => r._count > 0)
    .sort((a, b) => b._count - a._count)
    .map(r => `${roleLabels[r.role] || r.role} ${r._count}`);

  const orgBreakdownFormatted = orgBreakdown
    .filter(o => o._count > 0)
    .sort((a, b) => b._count - a._count)
    .map(o => `${orgTypeLabels[o.organizationType] || o.organizationType} ${o._count}`);

  const countriesBreakdownFormatted = countryBreakdown
    .filter(c => c._count > 0)
    .sort((a, b) => b._count - a._count)
    .map(c => `${c.country} ${c._count}`);

  const countriesTotal = countriesBreakdownFormatted.length;
  
  return {
    totals: {
      totalCompanies,
      totalUsers,
      totalTests: completedTests,
      totalReports,
      peopleTotal: distinctTestTakers.length,
      organizationsTotal: totalCompanies,
      countriesTotal,
      peopleBreakdown: peopleBreakdownFormatted,
      orgBreakdown: orgBreakdownFormatted,
      countriesBreakdown: countriesBreakdownFormatted
    },
    recentRegistrations,
    companyPerformance: companyPerformance.map(company => ({
      id: company.id,
      name: company.name,
      userCount: company._count.users,
      testCount: company._count.userTests,
      avgKPI: (() => {
        const valid = company.userTests.filter(ut => ut.report?.summary);
        return valid.length > 0
          ? valid.reduce((sum, ut) => sum + (ut.report?.kpis?.final || 0), 0) / valid.length
          : 0;
      })()
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
  
  return companies.map(company => {
    const validUserTests = company.userTests.filter(ut => ut.report?.summary);
    return {
      id: company.id,
      name: company.name,
      userCount: company._count.users,
      completedTests: company.userTests.length,
      avgKPI: validUserTests.length > 0
        ? validUserTests.reduce((sum, ut) => sum + (ut.report?.kpis?.final || 0), 0) / validUserTests.length
        : 0,
      avgTime: validUserTests.length > 0
        ? validUserTests.reduce((sum, ut) => sum + (ut.totalTime || 0), 0) / validUserTests.length
        : 0
    };
  });
}

async function getGlobalCKPIMetrics(filters = {}) {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const baseWhere = await applyAsyncFilters(buildReportWhere(filters), filters);

  const allReports = await prisma.report.findMany({
    where: baseWhere,
    include: { userTest: true },
    orderBy: { createdAt: 'desc' }
  });

  // Only consider reports with meaningful summaries
  const meaningful = allReports.filter(r => r.summary);

  // Current month reports
  const currentMonthReports = meaningful.filter(r => 
    new Date(r.createdAt) >= currentMonth
  );

  // Last month reports
  const lastMonthReports = meaningful.filter(r => 
    new Date(r.createdAt) >= lastMonth && new Date(r.createdAt) < currentMonth
  );

  // Calculate averages
  const globalAverageCKPI = calculateAverageKPI(meaningful);
  const currentMonthAverage = calculateAverageKPI(currentMonthReports);
  const lastMonthAverage = calculateAverageKPI(lastMonthReports);

  // Helper to calculate component averages
  const getComponentAverages = (reports) => {
    if (!reports.length) return { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0, impact: 0 };
    const sums = reports.reduce((acc, r) => {
      const comps = r.kpis?.components || {};
      acc.simplification += comps.simplification || 0;
      acc.originality += comps.originality || 0;
      acc.feasibility += comps.feasibility || 0;
      acc.criticalThinking += comps.criticalThinking || 0;
      acc.proactivity += comps.proactivity || 0;
      acc.impact += comps.impact || 0;
      return acc;
    }, { simplification: 0, originality: 0, feasibility: 0, criticalThinking: 0, proactivity: 0, impact: 0 });
    
    return {
      simplification: Math.round(sums.simplification / reports.length),
      originality: Math.round(sums.originality / reports.length),
      feasibility: Math.round(sums.feasibility / reports.length),
      criticalThinking: Math.round(sums.criticalThinking / reports.length),
      proactivity: Math.round(sums.proactivity / reports.length),
      impact: Math.round((sums.impact || 0) / reports.length)
    };
  };

  const currentComps = getComponentAverages(currentMonthReports);
  const lastComps = getComponentAverages(lastMonthReports);
  const globalComps = getComponentAverages(meaningful);

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
    proactivity: getTrendValue(currentComps.proactivity, lastComps.proactivity),
    impact: getTrendValue(currentComps.impact, lastComps.impact)
  };

  // Calculate trend (month-over-month change)
  const trend = lastMonthAverage > 0 
    ? Math.round(((currentMonthAverage - lastMonthAverage) / lastMonthAverage) * 100)
    : 0;

  // Get cross-company recurring problems and solutions (global view)
  const globalProblemSolution = await getProblemSolutionOverview({ companyId: null, filters });

  return {
    globalAverageCKPI,
    currentMonthAverage,
    lastMonthAverage,
    trend,
    averages: globalComps,
    componentTrends,
    totalReports: meaningful.length,
    currentMonthReports: currentMonthReports.length,
    lastMonthReports: lastMonthReports.length,
    globalProblems: globalProblemSolution.problems.slice(0, 5),
    globalSolutions: globalProblemSolution.solutions.slice(0, 5),
    lastUpdated: new Date().toLocaleString()
  };
}

async function getGlobalCKPITrend(days = 30, filters = {}) {
  const now = new Date();
  const startDate = new Date();
  if (days !== 'all') {
    startDate.setDate(now.getDate() - days);
  } else {
    startDate.setFullYear(2020, 0, 1);
  }

  const baseWhere = await applyAsyncFilters(buildReportWhere(filters), filters);
  if (days !== 'all') {
    baseWhere.createdAt = { gte: startDate };
  }

  const reports = await prisma.report.findMany({
    where: baseWhere,
    select: {
      createdAt: true,
      kpis: true,
      summary: true
    },
    orderBy: { createdAt: 'asc' }
  });

  // Group by date
  const dailyData = {};
  
  // Initialize all days in range
  if (days !== 'all') {
    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      dailyData[dateStr] = { sum: 0, count: 0 };
    }
  }

  const meaningful = reports.filter(r => r.summary);
  meaningful.forEach(r => {
    const dateStr = new Date(r.createdAt).toISOString().split('T')[0];
    if (!dailyData[dateStr]) {
      dailyData[dateStr] = { sum: 0, count: 0 };
    }
    dailyData[dateStr].sum += r.kpis?.final || 0;
    dailyData[dateStr].count += 1;
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

async function querySystemData(question, user, history = [], onChunk = null) {
  // Guardrails: sanitize input up front (strip injection, cap length).
  const { sanitizeUserInput } = require('../guardrailService');
  question = sanitizeUserInput(question) || question;

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

  // Fire vector search in parallel with problem overview (hides ~1s embedding API latency)
  let vectorSearchPromise = Promise.resolve([]);
  try {
    const { searchSimilarReports, buildRetrievalQuery } = require('../embeddingService');
    const retrievalQuery = buildRetrievalQuery(question, history);
    vectorSearchPromise = searchSimilarReports(null, retrievalQuery, { limit: 10, rerank: true }).catch(() => []);
  } catch { /* embedding service unavailable */ }

  const psOverview = await getProblemSolutionOverview({ companyId: null, limit: 20 });
  const summary = buildSystemSummary(companies, users, tests, assignments, psOverview);

  // Vector enrichment: await the already-running vector search
  let vectorHint = '';
  try {
    const matches = await vectorSearchPromise;

    if (matches.length) {
      const typeLabel = (m) => ({ problem: 'Problem', solution: 'Solution', ckpi: 'CKPI Evaluation', conversation: 'Conversation' }[m.type] || 'Report');
      const lines = ['\n\n--- Semantically Related Report Summaries ---'];
      lines.push('The following individual report entries are most relevant to this question (hybrid relevance >40%):');
      matches.forEach(m => lines.push(`  - [${typeLabel(m)}] "${m.summary}" — ${m.topic} (relevance: ${(m.score * 100).toFixed(0)}%)`));
      vectorHint = lines.join('\n');
    }
  } catch (vecErr) {
    console.warn('[VectorEnrichment] Error:', vecErr.message);
  }

  // Deterministic answers for common queries (no AI cost)
  const deterministic = tryDeterministicAdminAnswer(question, summary);
  if (deterministic) {
    if (typeof onChunk === 'function') {
      onChunk(deterministic.answer);
    }
    return {
      answer: deterministic.answer,
      source: 'deterministic',
      metadata: {
        intent: deterministic.intent,
        filtersApplied: ['global scope']
      }
    };
  }

  // Semantic layer: convert question to structured query against in-memory data
  try {
    const { semanticAnswer } = require('../semanticQueryService');
    const semantic = await semanticAnswer(question, summary, true);
    if (semantic) {
      if (typeof onChunk === 'function' && typeof semantic.answer === 'string') {
        onChunk(semantic.answer);
      }
      return semantic;
    }
  } catch (semErr) {
    console.warn('[SemanticQuery] Error:', semErr.message);
  }

  const system = `You are a Global Data Assistant for the RPLT platform.
Your purpose is to provide insights into platform-wide patterns, aggregated trends, and system-level performance.
You DO NOT have access to individual company names, user identities, or specific organizational structures for privacy reasons.
Use ONLY the provided anonymized dataset to answer the question.
If information is missing or restricted, explain that you only provide aggregated global insights.
Return a concise, actionable answer in Markdown.
You can generate charts or images when they would help visualize the global trends.`;

  const dataBlock = JSON.stringify(summary).slice(0, 25000);
  const content = `Dataset:\n\n${dataBlock}${vectorHint}`;

  try {
    const adminContext = { userId: user?.id, source: 'admin_query' };

    // Streaming mode: forward GPT tokens as they arrive.
    if (typeof onChunk === 'function') {
      return await new Promise((resolve, reject) => {
        let answer = '';
        streamChatCompletion({
          model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            ...history,
            { role: 'user', content: `${content}\n\nQuestion: ${question}` }
          ],
          temperature: 0.2,
          context: adminContext,
          onChunk: (chunk) => {
            answer += chunk;
            onChunk(chunk);
          },
          onDone: () => resolve({
            answer,
            chartSpec: null,
            imageUrl: null,
            imageSize: null,
            metadata: { vectorEnriched: !!vectorHint, intent: 'open_query', filtersApplied: ['global scope'] }
          }),
          onError: (err) => reject(err)
        });
      });
    }

    // Use enhanced GPT service with tools for chart/image generation
    const { content: answer, toolOutputs } = await runChatWithTools({
      model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: `${content}\n\nQuestion: ${question}` }
      ],
      temperature: 0.2,
      context: adminContext
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
      imageSize,
      metadata: { vectorEnriched: !!vectorHint }
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
        onDone: () => resolve({ answer, metadata: { vectorEnriched: !!vectorHint } }),
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
  const companyScoreMap = {};
  const rows = assignments.map(a => {
    const final = a.report?.kpis?.final ?? null;
    if (final != null) finals.push(final);
    if (a.status === 'COMPLETED') metrics.completed++; else if (a.status === 'IN_PROGRESS') metrics.inProgress++;

    if (final != null && a.companyId) {
      if (!companyScoreMap[a.companyId]) companyScoreMap[a.companyId] = { sum: 0, count: 0 };
      companyScoreMap[a.companyId].sum += final;
      companyScoreMap[a.companyId].count += 1;
    }
    
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

  // Pre-ranked companies by average CKPI (anonymized)
  const companyRankings = Object.entries(companyScoreMap)
    .map(([id, data]) => ({
      companyId: id,
      avgScore: Math.round(data.sum / data.count),
      reportCount: data.count
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
  const topCompaniesByScore = companyRankings.map((c, i) => ({
    label: `Company ${String.fromCharCode(65 + i)}`,
    avgScore: c.avgScore,
    reportCount: c.reportCount
  }));

  return {
    metrics,
    aggregatedPatterns: rows.slice(0, 200),
    problemSolutionOverview: psOverview,
    topCompaniesByScore
  };
}

function normalizeAdminQuestion(question) {
  return String(question || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tryDeterministicAdminAnswer(question, summary) {
  const q = normalizeAdminQuestion(question);
  if (!q) return null;

  const metrics = summary.metrics || {};
  const psOverview = summary.problemSolutionOverview || {};
  const topCompanies = summary.topCompaniesByScore || [];

  if ((q.includes('how many') || q.includes('total')) && q.includes('company')) {
    return { intent: 'total_companies', answer: `There are currently **${metrics.totalCompanies}** active companies on the platform.` };
  }

  if ((q.includes('how many') || q.includes('total')) && q.includes('user')) {
    return { intent: 'total_users', answer: `There are currently **${metrics.totalUsers}** active users across all companies.` };
  }

  if ((q.includes('how many') || q.includes('total')) && q.includes('test')) {
    return { intent: 'total_tests', answer: `There are **${metrics.totalTests}** tests and **${metrics.totalAssignments}** total user test assignments across the platform.` };
  }

  if ((q.includes('how many') || q.includes('total')) && (q.includes('report') || q.includes('assignment'))) {
    return { intent: 'total_assignments', answer: `There are **${metrics.totalAssignments}** total user test assignments across all companies.` };
  }

  if (q.includes('average ckpi') || q.includes('avg ckpi') || q.includes('average score') || q.includes('overall score') || q.includes('global score')) {
    return {
      intent: 'average_ckpi',
      answer: `The global average CKPI score across all companies is **${metrics.avgFinal ?? 0}**.`
    };
  }

  if (q.includes('completion') || q.includes('completed') || q.includes('in progress') || q.includes('overall status')) {
    return {
      intent: 'completion_status',
      answer: [
        'Platform-wide assignment status:',
        `- Completed: **${metrics.completed || 0}**`,
        `- In progress: **${metrics.inProgress || 0}**`,
        `- Unassigned/other: **${(metrics.totalAssignments || 0) - (metrics.completed || 0) - (metrics.inProgress || 0)}**`,
        `- Completion rate: **${metrics.totalAssignments > 0 ? Math.round((metrics.completed || 0) / metrics.totalAssignments * 100) : 0}%**`
      ].join('\n')
    };
  }

  if ((q.includes('top') || q.includes('best') || q.includes('highest')) && (q.includes('company') || q.includes('organization'))) {
    const rows = topCompanies.slice(0, 5);
    if (!rows.length) return { intent: 'top_companies', answer: 'No company scoring data is available yet.' };
    return {
      intent: 'top_companies',
      answer: ['Top companies by average CKPI:', ...rows.map((c, idx) => `${idx + 1}. **${c.label}** — avg CKPI **${c.avgScore}** (${c.reportCount} reports)`)].join('\n')
    };
  }

  if ((q.includes('bottom') || q.includes('worst') || q.includes('lowest')) && (q.includes('company') || q.includes('organization'))) {
    const rows = [...topCompanies].reverse().slice(0, 5);
    if (!rows.length) return { intent: 'bottom_companies', answer: 'No company scoring data is available yet.' };
    return {
      intent: 'bottom_companies',
      answer: ['Lowest scoring companies by average CKPI:', ...rows.map((c, idx) => `${idx + 1}. **${c.label}** — avg CKPI **${c.avgScore}** (${c.reportCount} reports)`)].join('\n')
    };
  }

  if ((q.includes('all') || q.includes('list') || q.includes('show')) && (q.includes('company') || q.includes('organization')) && (q.includes('score') || q.includes('ckpi') || q.includes('ranked'))) {
    if (!topCompanies.length) return { intent: 'all_companies_ranked', answer: 'No company scoring data is available yet.' };
    return {
      intent: 'all_companies_ranked',
      answer: ['All companies ranked by average CKPI:', ...topCompanies.map((c, idx) => `${idx + 1}. **${c.label}** — avg CKPI **${c.avgScore}** (${c.reportCount} reports)`)].join('\n')
    };
  }

  return null;
}

async function getProblemSolutionOverview({ companyId = null, from = null, to = null, limit = 10, filters = {} }) {
  const baseWhere = await applyAsyncFilters(buildReportWhere(filters), filters);
  if (companyId) baseWhere.userTest.companyId = companyId;

  const reports = await prisma.report.findMany({
    where: baseWhere,
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

  const isReal = (v) => {
    if (!v) return false;
    const blocked = ['unknown', 'n/a', 'not applicable', 'not_applicable', 'none', 'unknown problem', 'unknown solution', 'problem identification', 'business_problem', 'problem_discovery', 'solution direction', 'solution_direction', 'feasible_direction', 'soluzione non definita', 'identification of the problem', 'identificazione del problema', 'direction of the solution', 'direzione della soluzione'];
    return !blocked.includes(v.trim().toLowerCase());
  };

  // Build clusterId lookup from TeamProblem / TeamSolution tables
  const uniqueProblemKeys = new Set();
  const uniqueSolutionKeys = new Set();
  for (const r of filtered) {
    const da = r.detailedAnalysis || {};
    const cid = r.userTest?.companyId;
    if (cid && isReal(da.problem_key)) uniqueProblemKeys.add(`${cid}:${da.problem_key}`);
    if (cid && isReal(da.solution_key)) uniqueSolutionKeys.add(`${cid}:${da.solution_key}`);
  }

  const pClusterLookup = {};
  if (uniqueProblemKeys.size > 0) {
    const orClauses = Array.from(uniqueProblemKeys).map(k => {
      const idx = k.indexOf(':');
      return { companyId: parseInt(k.substring(0, idx)), key: k.substring(idx + 1) };
    });
    // Split into chunks of 100 to avoid overly large OR queries
    for (let i = 0; i < orClauses.length; i += 100) {
      const chunk = orClauses.slice(i, i + 100);
      const recs = await prisma.teamProblem.findMany({
        where: { OR: chunk },
        select: { companyId: true, key: true, clusterId: true, clusterLabel: true, topic: true }
      });
      for (const p of recs) {
        pClusterLookup[`${p.companyId}:${p.key}`] = { clusterId: p.clusterId, clusterLabel: p.clusterLabel || p.topic };
      }
    }
  }

  const sClusterLookup = {};
  if (uniqueSolutionKeys.size > 0) {
    const orClauses = Array.from(uniqueSolutionKeys).map(k => {
      const idx = k.indexOf(':');
      return { companyId: parseInt(k.substring(0, idx)), key: k.substring(idx + 1) };
    });
    for (let i = 0; i < orClauses.length; i += 100) {
      const chunk = orClauses.slice(i, i + 100);
      const recs = await prisma.teamSolution.findMany({
        where: { OR: chunk },
        select: { companyId: true, key: true, clusterId: true, clusterLabel: true, topic: true }
      });
      for (const s of recs) {
        sClusterLookup[`${s.companyId}:${s.key}`] = { clusterId: s.clusterId, clusterLabel: s.clusterLabel || s.topic };
      }
    }
  }

  const aggProblems = {};
  const aggSolutions = {};
  const pairs = {};
  const pKeyToDisplay = {};
  const sKeyToDisplay = {};

  filtered.forEach(r => {
    const kpis = r.kpis || {};
    const comp = kpis.components || {};
    const final = kpis.final || 0;
    const da = r.detailedAnalysis || {};
    const cid = r.userTest?.companyId;

    const pTopic = isReal(da.problem_topic) ? da.problem_topic : isReal(da.problem_cluster) ? da.problem_cluster : null;
    const sTopic = isReal(da.solution_topic) ? da.solution_topic : isReal(da.solution_cluster) ? da.solution_cluster : null;
    const pKey = isReal(da.problem_key) ? da.problem_key : pTopic ? pTopic.toLowerCase().replace(/\s+/g, '_') : null;
    const sKey = isReal(da.solution_key) ? da.solution_key : sTopic ? sTopic.toLowerCase().replace(/\s+/g, '_') : null;

    // Resolve clusterId for problem
    let pAggKey = pKey;
    let pDisplay = pTopic || (pKey ? pKey.replace(/_/g, ' ') : null);
    if (pKey && cid) {
      const ci = pClusterLookup[`${cid}:${pKey}`];
      if (ci?.clusterId) {
        pAggKey = ci.clusterId;
        pDisplay = ci.clusterLabel || pDisplay;
        pKeyToDisplay[pKey] = pDisplay;
      }
    }
    if (pKey) pKeyToDisplay[pKey] = pKeyToDisplay[pKey] || pDisplay;

    // Resolve clusterId for solution
    let sAggKey = sKey;
    let sDisplay = sTopic || (sKey ? sKey.replace(/_/g, ' ') : null);
    if (sKey && cid) {
      const ci = sClusterLookup[`${cid}:${sKey}`];
      if (ci?.clusterId) {
        sAggKey = ci.clusterId;
        sDisplay = ci.clusterLabel || sDisplay;
        sKeyToDisplay[sKey] = sDisplay;
      }
    }
    if (sKey) sKeyToDisplay[sKey] = sKeyToDisplay[sKey] || sDisplay;

    if (pAggKey) {
      const a = aggProblems[pAggKey] || { count: 0, sumFinal: 0, display: pDisplay, latestDate: 0, sourceKeys: new Set() };
      a.count += 1;
      a.sumFinal += final;
      a.sourceKeys.add(pKey);
      const reportTs = new Date(r.createdAt).getTime();
      if (reportTs > a.latestDate) a.latestDate = reportTs;
      aggProblems[pAggKey] = a;
    }

    if (sAggKey) {
      const a = aggSolutions[sAggKey] || {
        count: 0, sumFinal: 0, sumFeas: 0, sumProact: 0, sumImpact: 0,
        display: sDisplay, bestExample: null, maxFeas: -1, sourceKeys: new Set()
      };
      a.count += 1;
      a.sumFinal += final;
      a.sourceKeys.add(sKey);
      const feas = typeof comp.feasibility === 'number' ? comp.feasibility : 0;
      a.sumFeas += feas;
      a.sumProact += typeof comp.proactivity === 'number' ? comp.proactivity : 0;
      a.sumImpact += typeof comp.impact === 'number' ? comp.impact : 0;
      if (feas > a.maxFeas || !a.bestExample) {
        a.maxFeas = feas;
        a.bestExample = da.solution_summary || r.summary || null;
      }
      aggSolutions[sAggKey] = a;
    }

    if (pAggKey && sAggKey) {
      const matrixKey = `${pAggKey}__${sAggKey}`;
      const a = pairs[matrixKey] || { count: 0, sumFinal: 0, pDisplay, sDisplay, pAggKey, sAggKey };
      a.count += 1;
      a.sumFinal += final;
      pairs[matrixKey] = a;
    }
  });

  const problems = Object.entries(aggProblems)
    .map(([key, v]) => ({
      key,
      cluster: v.display || key.replace(/_/g, ' '),
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      latestDate: v.latestDate
    }))
    .sort((a, b) => b.count - a.count || b.latestDate - a.latestDate)
    .slice(0, limit);

  const solutions = Object.entries(aggSolutions)
    .map(([key, v]) => ({
      key,
      cluster: v.display || key.replace(/_/g, ' '),
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      avgFeasibility: Math.round(v.sumFeas / v.count),
      avgProactivity: Math.round(v.sumProact / v.count),
      avgImpact: Math.round((v.sumImpact || 0) / v.count),
      bestExample: v.bestExample
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const matrix = Object.entries(pairs)
    .map(([key, v]) => ({
      problem: v.pDisplay || v.pAggKey.replace(/_/g, ' '),
      solution: v.sDisplay || v.sAggKey.replace(/_/g, ' '),
      problemKey: v.pAggKey,
      solutionKey: v.sAggKey,
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit * 3);

  // Build problem categories with individual reports for accordion display
  const pKeyToClusterId = {};
  for (const [lk, ci] of Object.entries(pClusterLookup)) {
    pKeyToClusterId[lk] = ci.clusterId;
  }
  const problemCategories = Object.entries(aggProblems)
    .map(([key, v]) => ({
      key,
      cluster: v.display || key.replace(/_/g, ' '),
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      reports: filtered
        .filter(r => {
          const da = r.detailedAnalysis || {};
          const rPKey = isReal(da.problem_key) ? da.problem_key : null;
          const rCid = r.userTest?.companyId;
          let rAggKey = rPKey;
          if (rPKey && rCid) {
            const ci = pClusterLookup[`${rCid}:${rPKey}`];
            if (ci?.clusterId) rAggKey = ci.clusterId;
          }
          return rAggKey === key && da.problem_summary;
        })
        .map(r => ({
          id: r.id,
          summary: r.detailedAnalysis.problem_summary,
          date: r.createdAt
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
    }))
    .sort((a, b) => b.count - a.count);

  // Build solution categories with individual reports for accordion display
  const sKeyToClusterId = {};
  for (const [lk, ci] of Object.entries(sClusterLookup)) {
    sKeyToClusterId[lk] = ci.clusterId;
  }
  const solutionCategories = Object.entries(aggSolutions)
    .map(([key, v]) => ({
      key,
      cluster: v.display || key.replace(/_/g, ' '),
      count: v.count,
      avgFinal: Math.round(v.sumFinal / v.count),
      avgFeasibility: Math.round(v.sumFeas / v.count),
      avgImpact: Math.round((v.sumImpact || 0) / v.count),
      bestExample: v.bestExample,
      reports: filtered
        .filter(r => {
          const da = r.detailedAnalysis || {};
          const rSKey = isReal(da.solution_key) ? da.solution_key : null;
          const rCid = r.userTest?.companyId;
          let rAggKey = rSKey;
          if (rSKey && rCid) {
            const ci = sClusterLookup[`${rCid}:${rSKey}`];
            if (ci?.clusterId) rAggKey = ci.clusterId;
          }
          return rAggKey === key && (da.solution_summary || r.summary);
        })
        .map(r => {
          const da = r.detailedAnalysis || {};
          return {
            id: r.id,
            summary: da.solution_summary || r.summary || 'No description available',
            date: r.createdAt
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
    }))
    .sort((a, b) => b.count - a.count);

  return { problems, solutions, matrix, problemCategories, solutionCategories, totalReports: filtered.length };
}

async function assignClusters() {
  const results = { problemsAssigned: 0, solutionsAssigned: 0 };

  // Helper: generate stable clusterId from topic
  function genId(topic) {
    if (!topic) return null;
    return topic.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 100) || null;
  }

  // --- TeamProblems ---
  const unclusteredProblems = await prisma.teamProblem.findMany({
    where: { clusterId: null, topic: { not: null } },
    select: { id: true, topic: true }
  });

  const topicGroups = {};
  for (const p of unclusteredProblems) {
    if (!p.topic) continue;
    const key = p.topic.trim().toLowerCase();
    if (!topicGroups[key]) topicGroups[key] = { ids: [], label: p.topic };
    topicGroups[key].ids.push(p.id);
  }

  for (const [, group] of Object.entries(topicGroups)) {
    const cid = genId(group.label);
    if (!cid) continue;
    await prisma.teamProblem.updateMany({
      where: { id: { in: group.ids } },
      data: { clusterId: cid, clusterLabel: group.label }
    });
    results.problemsAssigned += group.ids.length;
  }

  // --- TeamSolutions ---
  const unclusteredSolutions = await prisma.teamSolution.findMany({
    where: { clusterId: null, topic: { not: null } },
    select: { id: true, topic: true }
  });

  const solTopicGroups = {};
  for (const s of unclusteredSolutions) {
    if (!s.topic) continue;
    const key = s.topic.trim().toLowerCase();
    if (!solTopicGroups[key]) solTopicGroups[key] = { ids: [], label: s.topic };
    solTopicGroups[key].ids.push(s.id);
  }

  for (const [, group] of Object.entries(solTopicGroups)) {
    const cid = genId(group.label);
    if (!cid) continue;
    await prisma.teamSolution.updateMany({
      where: { id: { in: group.ids } },
      data: { clusterId: cid, clusterLabel: group.label }
    });
    results.solutionsAssigned += group.ids.length;
  }

  return results;
}

module.exports.getProblemSolutionOverview = getProblemSolutionOverview;
module.exports.assignClusters = assignClusters;
