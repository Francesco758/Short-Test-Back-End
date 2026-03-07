const express = require('express');
const router = express.Router();
const { authRequired, companyAdminOnly } = require('../../middleware/auth.js');
const controller = require('../../controllers/company/reportController.js');

router.get('/user-reports', authRequired, companyAdminOnly, controller.getUserReports);
router.get('/user-test/:userTestId', authRequired, companyAdminOnly, controller.getUserTestReport);
router.get('/stats', authRequired, companyAdminOnly, controller.getCompanyStats);
router.get('/problem-solution-overview', authRequired, companyAdminOnly, controller.getProblemSolutionOverview);
router.get('/deadlines', authRequired, companyAdminOnly, controller.getUpcomingDeadlines);
router.get('/ckpi-metrics', authRequired, companyAdminOnly, controller.getCompanyCKPIMetrics);
router.post('/query', authRequired, companyAdminOnly, controller.queryCompanyData);

module.exports = router;
