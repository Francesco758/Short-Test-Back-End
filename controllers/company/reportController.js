const reportService = require('../../services/company/reportService');

async function getUserReports(req, res, next) {
  try {
    const reports = await reportService.getUserReports(req.user.companyId);
    res.json(reports);
  } catch (err) { next(err); }
}

async function getUserTestReport(req, res, next) {
  try {
    const report = await reportService.getUserTestReport(parseInt(req.params.userTestId), req.user.companyId);
    res.json(report);
  } catch (err) { next(err); }
}

async function getCompanyStats(req, res, next) {
  try {
    const stats = await reportService.getCompanyStats(req.user.companyId);
    res.json(stats);
  } catch (err) { next(err); }
}

async function getProblemSolutionOverview(req, res, next) {
  try {
    const { from, to, limit = 10 } = req.query;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const limitNum = parseInt(limit) || 10;
    
    const overview = await reportService.getProblemSolutionOverview(req.user.companyId, {
      from: fromDate,
      to: toDate,
      limit: limitNum
    });
    res.json(overview);
  } catch (err) { next(err); }
}

async function getUpcomingDeadlines(req, res, next) {
  try {
    const rows = await reportService.getUpcomingDeadlines(req.user.companyId);
    res.json(rows);
  } catch (err) { next(err); }
}

async function queryCompanyData(req, res, next) {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    const result = await reportService.queryCompanyData(req.user.companyId, question.trim());
    res.json(result);
  } catch (err) { next(err); }
}

async function getCompanyCKPIMetrics(req, res, next) {
  try {
    const metrics = await reportService.getCompanyCKPIMetrics(req.user.companyId);
    res.json(metrics);
  } catch (err) { next(err); }
}

module.exports = { 
  getUserReports, 
  getUserTestReport, 
  getCompanyStats,
  getProblemSolutionOverview,
  getUpcomingDeadlines,
  queryCompanyData,
  getCompanyCKPIMetrics
};
