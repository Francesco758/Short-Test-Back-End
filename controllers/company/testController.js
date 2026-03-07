// controllers/company/testController.js
const testService = require('../../services/company/testService');

async function getAssignedTests(req, res, next) {
  try {
    const tests = await testService.getAssignedTests(req.user.companyId);
    res.json(tests);
  } catch (err) { 
    next(err); 
  }
}

async function assignTestToUsers(req, res, next) {
  try {
    const { userIds, notify = true, scheduleAt = null, brief = null, deadline = null } = req.body;
    
    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({ error: 'User IDs array is required' });
    }

    const result = await testService.assignTestToUsers({
      testId: parseInt(req.params.testId),
      userIds,
      companyId: req.user.companyId,
      notify,
      scheduleAt,
      brief,
      deadline
    });
    
    res.status(201).json({
      success: true,
      message: `Test assigned to ${userIds.length} user(s) successfully`,
      data: result
    });
  } catch (err) { 
    next(err); 
  }
}

async function bulkAssignTests(req, res, next) {
  try {
    const { testIds, userIds, notify = true, scheduleAt = null, deadline = null } = req.body;
    
    if (!testIds || !Array.isArray(testIds)) {
      return res.status(400).json({ error: 'Test IDs array is required' });
    }
    
    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({ error: 'User IDs array is required' });
    }

    const result = await testService.bulkAssignTests({
      testIds,
      userIds,
      companyId: req.user.companyId,
      notify,
      scheduleAt,
      deadline
    });
    
    res.status(201).json({
      success: true,
      message: `${testIds.length} test(s) assigned to ${userIds.length} user(s) successfully`,
      data: result
    });
  } catch (err) { 
    next(err); 
  }
}

module.exports = { 
  getAssignedTests, 
  assignTestToUsers, 
  bulkAssignTests 
};
