const conversationService = require('../services/conversationServiceSimplified');
const logger = require('../utils/logger');

module.exports = {
  /**
   * Start a new test conversation
   * POST /api/conversation/start
   */
  startTest: async (req, res, next) => {
    try {
      const result = await conversationService.startTestConversation({
        user: req.user,
        body: req.body,
        requestId: req.id
      });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Send a message in the conversation
   * POST /api/conversation/message
   */
  sendMessage: async (req, res, next) => {
    try {
      const result = await conversationService.handleUserMessage({
        user: req.user,
        body: req.body,
        requestId: req.id
      });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Complete the test and generate report
   * POST /api/conversation/complete
   */
  completeTest: async (req, res, next) => {
    try {
      const { userTestId } = req.body;
      if (!userTestId) {
        return res.status(400).json({ error: 'userTestId is required' });
      }

      const result = await conversationService.completeTest({
        user: req.user,
        userTestId,
        requestId: req.id
      });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Heartbeat — user is still active on the test
   * POST /api/conversation/heartbeat
   */
  heartbeat: async (req, res, next) => {
    try {
      const { userTestId } = req.body;
      if (!userTestId) {
        return res.status(400).json({ error: 'userTestId is required' });
      }
      const result = await conversationService.heartbeat({
        userTestId,
        userId: req.user.id
      });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
};