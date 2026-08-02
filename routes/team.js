const express = require('express');
const router = express.Router();
const { authRequired } = require('../middleware/auth');
const controller = require('../controllers/teamController');

router.get('/problems', authRequired, controller.getProblems);
router.get('/solutions', authRequired, controller.getSolutions);
router.post('/solutions/:id/like', authRequired, controller.likeSolution);
router.post('/start-problem', authRequired, controller.startProblemTest);
router.post('/start-solution', authRequired, controller.startSolutionTest);

module.exports = router;
