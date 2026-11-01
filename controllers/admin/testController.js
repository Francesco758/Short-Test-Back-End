const testService = require('../../services/admin/testServiceSimplified');

async function createTest(req, res, next) {
  try {
    const test = await testService.createTest({ ...req.body, createdById: req.user.id });
    res.status(201).json(test);
  } catch (err) {
    next(err);
  }
}

async function getAllTests(req, res, next) {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const tests = await testService.getAllTests({ page, limit, status, search });
    res.json(tests);
  } catch (err) {
    next(err);
  }
}

async function getTestById(req, res, next) {
  try {
    const test = await testService.getTestById(parseInt(req.params.id));
    res.json(test);
  } catch (err) {
    next(err);
  }
}

async function updateTest(req, res, next) {
  try {
    const test = await testService.updateTest(parseInt(req.params.id), req.body);
    res.json(test);
  } catch (err) {
    next(err);
  }
}

async function deleteTest(req, res, next) {
  try {
    await testService.deleteTest(parseInt(req.params.id));
    res.json({ message: 'Test deleted successfully' });
  } catch (err) {
    next(err);
  }
}

async function assignTestToCompany(req, res, next) {
  try {
    const assignment = await testService.assignTestToCompany({
      testId: parseInt(req.params.testId),
      companyId: parseInt(req.body.companyId),
      assignedById: req.user.id
    });
    res.status(201).json(assignment);
  } catch (err) {
    next(err);
  }
}

async function unassignTestFromCompany(req, res, next) {
  try {
    const result = await testService.unassignTestFromCompany({
      testId: parseInt(req.params.testId),
      companyId: parseInt(req.params.companyId)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function bulkAssignTests(req, res, next) {
  try {
    const result = await testService.bulkAssignTests({
      testIds: req.body.testIds,
      companyIds: req.body.companyIds,
      assignedById: req.user.id
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function getCustomTest(req, res, next) {
  try {
    const test = await testService.getCustomTest();
    res.json(test || null);
  } catch (err) {
    next(err);
  }
}

async function createCustomTest(req, res, next) {
  try {
    const test = await testService.createCustomTest({ ...req.body, createdById: req.user.id });
    res.status(201).json(test);
  } catch (err) {
    next(err);
  }
}

async function updateCustomTest(req, res, next) {
  try {
    const test = await testService.updateCustomTest(req.body);
    res.json(test);
  } catch (err) {
    next(err);
  }
}

async function deleteCustomTest(req, res, next) {
  try {
    await testService.deleteCustomTest();
    res.json({ message: 'Custom test deleted successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createTest,
  getAllTests,
  getTestById,
  updateTest,
  deleteTest,
  assignTestToCompany,
  unassignTestFromCompany,
  bulkAssignTests,
  getCustomTest,
  createCustomTest,
  updateCustomTest,
  deleteCustomTest
};
