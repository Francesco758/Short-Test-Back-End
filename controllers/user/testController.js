const testService = require('../../services/user/testService');

async function getAssignedTests(req, res, next) {
  try {
    const tests = await testService.getAssignedTests(req.user.id);
    res.json(tests);
  } catch (err) { next(err); }
}

async function startTest(req, res, next) {
  try {
    const result = await testService.startTest(parseInt(req.params.userTestId), req.user.id);
    res.json(result);
  } catch (err) { next(err); }
}

async function submitAnswer(req, res, next) {
  try {
    const result = await testService.submitAnswer({
      userTestId: parseInt(req.params.userTestId),
      userId: req.user.id,
      ...req.body
    });
    res.json(result);
  } catch (err) { next(err); }
}

async function finishTest(req, res, next) {
  try {
    const result = await testService.finishTest(parseInt(req.params.userTestId), req.user.id);
    res.json(result);
  } catch (err) { next(err); }
}

// NEW: Get test status for frontend sync
async function getTestStatus(req, res, next) {
  try {
    const result = await testService.getTestStatus(
      parseInt(req.params.userTestId), 
      req.user.id
    );
    res.json(result);
  } catch (err) { next(err); }
}

module.exports = { 
  getAssignedTests, 
  startTest, 
  submitAnswer, 
  finishTest, 
  getTestStatus 
};