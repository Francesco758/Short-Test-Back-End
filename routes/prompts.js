const express = require('express');
const { authRequired, superAdminOnly } = require('../middleware/auth');
const controller = require('../controllers/promptController');

const router = express.Router();

router.get('/', authRequired, controller.listPrompts);
router.get('/:id', authRequired, controller.getPrompt);
router.post('/', authRequired, superAdminOnly, controller.createPrompt);
router.put('/:id', authRequired, superAdminOnly, controller.updatePrompt);
router.delete('/:id', authRequired, superAdminOnly, controller.deletePrompt);

module.exports = router;