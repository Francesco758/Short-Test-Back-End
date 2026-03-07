const express = require('express');
const router = express.Router();
const { authRequired, companyAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/company/userController');

router.post('/', authRequired, companyAdminOnly, controller.createUser);
router.get('/', authRequired, companyAdminOnly, controller.getCompanyUsers);
router.put('/:id', authRequired, companyAdminOnly, controller.updateUser);
router.delete('/:id', authRequired, companyAdminOnly, controller.deleteUser);
router.post('/bulk', authRequired, companyAdminOnly, controller.bulkCreateUsers);

module.exports = router;