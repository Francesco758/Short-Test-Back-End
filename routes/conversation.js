const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const { conversationStartLimiter, conversationMessageLimiter, conversationCompleteLimiter } = require("../middleware/rateLimiter");
const conversationController = require("../controllers/conversationControllerSimplified");

// Simplified dynamic conversation routes with rate limiting
router.post("/start", authRequired, conversationStartLimiter, conversationController.startTest);
router.post("/message", authRequired, conversationMessageLimiter, conversationController.sendMessage);
router.post("/complete", authRequired, conversationCompleteLimiter, conversationController.completeTest);
router.post("/heartbeat", authRequired, conversationController.heartbeat);

module.exports = router;