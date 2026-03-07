const dashboardService = require('../../services/admin/dashboardService');

async function getDashboardStats(req, res, next) {
  try {
    const stats = await dashboardService.getDashboardStats();
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
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    const result = await dashboardService.querySystemData(question.trim());
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getGlobalCKPIMetrics(req, res, next) {
  try {
    const metrics = await dashboardService.getGlobalCKPIMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
}

async function getGlobalCKPITrend(req, res, next) {
  try {
    const { days } = req.query;
    const trend = await dashboardService.getGlobalCKPITrend(days ? parseInt(days) : 30);
    res.json(trend);
  } catch (err) {
    next(err);
  }
}

async function getProblemSolutionOverview(req, res, next) {
  try {
    const { companyId, from, to, limit } = req.query;
    const overview = await dashboardService.getProblemSolutionOverview({
      companyId: companyId ? parseInt(companyId) : null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      limit: limit ? parseInt(limit) : 10
    });
    res.json(overview);
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
  getProblemSolutionOverview
};
