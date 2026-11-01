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

// NEW: standard shorTests the current user is allowed to start on their own
async function getAvailableTests(req, res, next) {
  try {
    const result = await testService.getAvailableStandardTests(req.user);
    res.json(result);
  } catch (err) { next(err); }
}

// NEW: start a brand new standard shorTest (self-serve, and the API entry point
// that external systems — Teams, Outlook, extensions, intranets — can call later)
async function launchTest(req, res, next) {
  try {
    const { testId = null, source = null, context = null } = req.body || {};
    const result = await testService.launchStandardTest({
      user: req.user,
      testId,
      source,
      context
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
}

module.exports = { 
  getAssignedTests, 
  startTest, 
  submitAnswer, 
  finishTest, 
  getTestStatus,
  getAvailableTests,
  launchTest
};