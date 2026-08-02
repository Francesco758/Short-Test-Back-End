const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/admin/usageController');

router.get('/summary', authRequired, superAdminOnly, controller.getSummary);
router.get('/by-company', authRequired, superAdminOnly, controller.getByCompany);
router.get('/by-user', authRequired, superAdminOnly, controller.getByUser);
router.get('/by-source', authRequired, superAdminOnly, controller.getBySource);
router.get('/trends', authRequired, superAdminOnly, controller.getTrends);

module.exports = router;
