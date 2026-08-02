const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/admin/settingsController');

router.get('/openai', authRequired, superAdminOnly, controller.getOpenAI);
router.put('/openai', authRequired, superAdminOnly, controller.updateOpenAI);

router.get('/transformachine', authRequired, superAdminOnly, controller.getTransforMachine);
router.put('/transformachine', authRequired, superAdminOnly, controller.updateTransforMachine);

module.exports = router;
