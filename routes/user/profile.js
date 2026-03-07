const express = require('express');
const router = express.Router();
const { authRequired } = require('../../middleware/auth');
const controller = require('../../controllers/user/profileController');

router.get('/', authRequired, controller.getProfile);
router.put('/', authRequired, controller.updateProfile);
router.post('/change-password', authRequired, controller.changePassword);

module.exports = router;