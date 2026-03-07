const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/admin/userController');

router.post('/', authRequired, superAdminOnly, controller.createUser);
router.get('/', authRequired, superAdminOnly, controller.getAllUsers);
router.get('/:id', authRequired, superAdminOnly, controller.getUserById);
router.put('/:id', authRequired, superAdminOnly, controller.updateUser);
router.delete('/:id', authRequired, superAdminOnly, controller.deleteUser);
router.post('/bulk', authRequired, superAdminOnly, controller.bulkCreateUsers);

module.exports = router;