const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const { adminQueryLimiter } = require('../../middleware/rateLimiter');
const controller = require('../../controllers/admin/dashboardController');

router.get('/stats', authRequired, superAdminOnly, controller.getDashboardStats);
router.get('/recent-activity', authRequired, superAdminOnly, controller.getRecentActivity);
router.get('/company-performance', authRequired, superAdminOnly, controller.getCompanyPerformance);
router.get('/global-metrics', authRequired, superAdminOnly, controller.getGlobalCKPIMetrics);
router.get('/ckpi-trend', authRequired, superAdminOnly, controller.getGlobalCKPITrend);
router.post('/query', authRequired, superAdminOnly, adminQueryLimiter, controller.querySystemData);
router.post('/query/stream', authRequired, superAdminOnly, adminQueryLimiter, controller.querySystemDataStream);
router.get('/problem-solution-overview', authRequired, superAdminOnly, controller.getProblemSolutionOverview);
router.post('/assign-clusters', authRequired, superAdminOnly, controller.assignClusters);
router.get('/conversations', authRequired, superAdminOnly, controller.getAiConversations);
router.get('/conversations/:id', authRequired, superAdminOnly, controller.getAiConversation);
router.delete('/conversations/:id', authRequired, superAdminOnly, controller.deleteAiConversation);

module.exports = router;
