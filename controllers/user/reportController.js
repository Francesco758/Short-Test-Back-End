const reportService = require('../../services/user/reportService');

async function getUserCKPIMetrics(req, res, next) {
  try {
    const metrics = await reportService.getUserCKPIMetrics(req.user.id);
    res.json(metrics);
  } catch (err) { next(err); }
}

module.exports = { getUserCKPIMetrics };