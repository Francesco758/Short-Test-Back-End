const express = require('express');
const router = express.Router();
const { authRequired } = require('../../middleware/auth.js');
const controller = require('../../controllers/user/reportController.js');

router.get('/ckpi-metrics', authRequired, controller.getUserCKPIMetrics);

module.exports = router;