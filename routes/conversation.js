const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const conversationController = require("../controllers/conversationControllerSimplified");

// Simplified dynamic conversation routes
router.post("/start", authRequired, conversationController.startTest);
router.post("/message", authRequired, conversationController.sendMessage);
router.post("/complete", authRequired, conversationController.completeTest);

module.exports = router;