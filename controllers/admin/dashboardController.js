const dashboardService = require('../../services/admin/dashboardService');

function parseFilters(req) {
  const { period, ages, functions, orgSizes, orgTypes } = req.query;
  return {
    period: period || null,
    ages: ages ? ages.split(',').filter(Boolean) : null,
    functions: functions ? functions.split(',').filter(Boolean) : null,
    orgSizes: orgSizes ? orgSizes.split(',').filter(Boolean) : null,
    orgTypes: orgTypes ? orgTypes.split(',').filter(Boolean) : null
  };
}

async function getDashboardStats(req, res, next) {
  try {
    const filters = parseFilters(req);
    const stats = await dashboardService.getDashboardStats(filters);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

async function getRecentActivity(req, res, next) {
  try {
    const { limit = 10 } = req.query;
    const activity = await dashboardService.getRecentActivity(parseInt(limit));
    res.json(activity);
  } catch (err) {
    next(err);
  }
}

async function getCompanyPerformance(req, res, next) {
  try {
    const performance = await dashboardService.getCompanyPerformance();
    res.json(performance);
  } catch (err) {
    next(err);
  }
}

async function querySystemData(req, res, next) {
  try {
    const { question, history } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    const result = await dashboardService.querySystemData(question.trim(), req.user, history || []);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getGlobalCKPIMetrics(req, res, next) {
  try {
    const filters = parseFilters(req);
    const metrics = await dashboardService.getGlobalCKPIMetrics(filters);
    res.json(metrics);
  } catch (err) {
    next(err);
  }
}

async function getGlobalCKPITrend(req, res, next) {
  try {
    const { days } = req.query;
    const filters = parseFilters(req);
    const trend = await dashboardService.getGlobalCKPITrend(days === 'all' ? 'all' : (days ? parseInt(days) : 30), filters);
    res.json(trend);
  } catch (err) {
    next(err);
  }
}

async function getProblemSolutionOverview(req, res, next) {
  try {
    const { companyId, from, to, limit } = req.query;
    const filters = parseFilters(req);
    const overview = await dashboardService.getProblemSolutionOverview({
      companyId: companyId ? parseInt(companyId) : null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      limit: limit ? parseInt(limit) : 10,
      filters
    });
    res.json(overview);
  } catch (err) {
    next(err);
  }
}

async function assignClusters(req, res, next) {
  try {
    const result = await dashboardService.assignClusters();
    res.json({ message: 'Clusters assigned', ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getCompanyPerformance,
  getGlobalCKPIMetrics,
  getGlobalCKPITrend,
  querySystemData,
  getProblemSolutionOverview,
  assignClusters
};
