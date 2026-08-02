const express = require('express');
const router = express.Router();
const { authRequired, adminOnly } = require('../middleware/auth');
const controller = require('../controllers/admin/dashboardController');

// Observatory routes - read-only dashboard data for any admin (SUPER_ADMIN + COMPANY_ADMIN)
router.get('/stats', authRequired, adminOnly, controller.getDashboardStats);
router.get('/global-metrics', authRequired, adminOnly, controller.getGlobalCKPIMetrics);
router.get('/ckpi-trend', authRequired, adminOnly, controller.getGlobalCKPITrend);
router.get('/problem-solution-overview', authRequired, adminOnly, controller.getProblemSolutionOverview);
router.post('/query', authRequired, adminOnly, controller.querySystemData);

module.exports = router;
