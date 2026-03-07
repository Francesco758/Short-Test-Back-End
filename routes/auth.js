const express = require('express');
const authController = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authRequired, authController.me);
router.post('/change-password', authRequired, authController.changePassword); // ADD THIS LINE

module.exports = router;