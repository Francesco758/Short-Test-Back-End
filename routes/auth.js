const express = require('express');
const authController = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/guest-login', authController.guestLogin);
router.get('/me', authRequired, authController.me);
router.post('/change-password', authRequired, authController.changePassword);

module.exports = router;