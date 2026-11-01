const express = require('express');
const router = express.Router();
const { authRequired, companyAdminOnly } = require('../../middleware/auth.js');
const { companyQueryLimiter } = require('../../middleware/rateLimiter');
const controller = require('../../controllers/company/reportController.js');

router.get('/user-reports', authRequired, companyAdminOnly, controller.getUserReports);
router.get('/user-test/latest/:userId', authRequired, companyAdminOnly, controller.getLatestUserTestReportByUserId);
router.get('/user-test/:userTestId', authRequired, companyAdminOnly, controller.getUserTestReport);
router.get('/user/:userId/global-summary', authRequired, companyAdminOnly, controller.getUserGlobalSummary);
router.get('/stats', authRequired, companyAdminOnly, controller.getCompanyStats);
router.get('/problem-solution-overview', authRequired, companyAdminOnly, controller.getProblemSolutionOverview);
router.get('/deadlines', authRequired, companyAdminOnly, controller.getUpcomingDeadlines);
router.get('/ckpi-metrics', authRequired, companyAdminOnly, controller.getCompanyCKPIMetrics);
router.post('/query', authRequired, companyAdminOnly, companyQueryLimiter, controller.queryCompanyData);
router.post('/query/stream', authRequired, companyAdminOnly, companyQueryLimiter, controller.queryCompanyDataStream);
router.get('/conversations', authRequired, companyAdminOnly, controller.getAiConversations);
router.get('/conversations/:id', authRequired, companyAdminOnly, controller.getAiConversation);
router.delete('/conversations/:id', authRequired, companyAdminOnly, controller.deleteAiConversation);

module.exports = router;
