const express = require('express');
const router = express.Router();
const { authRequired, superAdminOnly } = require('../../middleware/auth');
const controller = require('../../controllers/admin/companyController');

router.post('/', authRequired, superAdminOnly, controller.createCompany);
router.get('/', authRequired, superAdminOnly, controller.getAllCompanies);
router.get('/:id', authRequired, superAdminOnly, controller.getCompanyById);
router.put('/:id', authRequired, superAdminOnly, controller.updateCompany);
router.delete('/:id', authRequired, superAdminOnly, controller.deleteCompany);
router.get('/:companyId/users', authRequired, superAdminOnly, controller.getCompanyUsers);
router.get('/:companyId/reports', authRequired, superAdminOnly, controller.getCompanyReports);

module.exports = router;