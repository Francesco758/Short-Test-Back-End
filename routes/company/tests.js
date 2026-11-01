// routes/company/tests.js
const express = require('express');
const router = express.Router();
const { authRequired, companyAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/company/testController');

router.get('/assigned', authRequired, companyAdminOnly, controller.getAssignedTests);
router.get('/guest-access', authRequired, companyAdminOnly, controller.getGuestAccessStatus);
router.post('/guest-access', authRequired, companyAdminOnly, controller.toggleCompanyGuestMode);
router.post('/bulk-assign', authRequired, companyAdminOnly, controller.bulkAssignTests);
router.post('/:testId/assign-users', authRequired, companyAdminOnly, controller.assignTestToUsers);
router.get('/guest-companies', controller.getGuestAccessCompanies);

module.exports = router;