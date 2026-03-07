const express = require('express');
const router = express.Router();
const { authRequired } = require('../../middleware/auth');
const controller = require('../../controllers/user/testController');

router.get('/assigned', authRequired, controller.getAssignedTests);
router.post('/:userTestId/start', authRequired, controller.startTest);
router.post('/:userTestId/answer', authRequired, controller.submitAnswer);
router.post('/:userTestId/finish', authRequired, controller.finishTest);
// ADD THIS LINE - Status endpoint for auto-advance sync
router.get('/:userTestId/status', authRequired, controller.getTestStatus);

module.exports = router;