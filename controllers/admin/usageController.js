const usageService = require('../../services/usageService');

async function getSummary(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const result = await usageService.getUsageSummary({ startDate, endDate });
    res.json(result);
  } catch (err) { next(err); }
}

async function getByCompany(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const result = await usageService.getUsageByCompany({ startDate, endDate });
    res.json(result);
  } catch (err) { next(err); }
}

async function getByUser(req, res, next) {
  try {
    const { startDate, endDate, companyId } = req.query;
    const result = await usageService.getUsageByUser({ startDate, endDate, companyId: companyId ? parseInt(companyId) : undefined });
    res.json(result);
  } catch (err) { next(err); }
}

async function getBySource(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const result = await usageService.getUsageBySource({ startDate, endDate });
    res.json(result);
  } catch (err) { next(err); }
}

async function getTrends(req, res, next) {
  try {
    const { startDate, endDate, granularity } = req.query;
    const result = await usageService.getUsageTrends({ startDate, endDate, granularity });
    res.json(result);
  } catch (err) { next(err); }
}

module.exports = {
  getSummary,
  getByCompany,
  getByUser,
  getBySource,
  getTrends,
};
