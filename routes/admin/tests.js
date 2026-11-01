const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/admin/testController');

// Place custom routes BEFORE parameterized routes to avoid '/custom' matching '/:id'
router.get('/custom', authRequired, superAdminOnly, controller.getCustomTest);
router.post('/custom', authRequired, superAdminOnly, controller.createCustomTest);
router.put('/custom', authRequired, superAdminOnly, controller.updateCustomTest);
router.delete('/custom', authRequired, superAdminOnly, controller.deleteCustomTest);

router.post('/', authRequired, superAdminOnly, controller.createTest);
router.get('/', authRequired, superAdminOnly, controller.getAllTests);
router.post('/bulk-assign', authRequired, superAdminOnly, controller.bulkAssignTests);
router.post('/:testId/assign', authRequired, superAdminOnly, controller.assignTestToCompany);
router.delete('/:testId/assign/:companyId', authRequired, superAdminOnly, controller.unassignTestFromCompany);
router.get('/:id', authRequired, superAdminOnly, controller.getTestById);
router.put('/:id', authRequired, superAdminOnly, controller.updateTest);
router.delete('/:id', authRequired, superAdminOnly, controller.deleteTest);

module.exports = router;
