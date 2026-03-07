const { body, param, query } = require('express-validator');

// Common validation rules
const emailValidation = body('email').isEmail().normalizeEmail();
const passwordValidation = body('password').isLength({ min: 6 });
const nameValidation = body('name').optional().isLength({ min: 2, max: 100 }).trim();

// Admin validations
const createCompanyValidation = [
  body('name').isLength({ min: 2, max: 100 }).trim(),
  body('description').optional().isLength({ max: 500 }).trim()
];

const assignTestValidation = [
  body('companyId').isInt({ min: 1 }),
  body('testId').isInt({ min: 1 })
];

// Company validations
const createUserValidation = [
  emailValidation,
  passwordValidation,
  nameValidation,
  body('role').isIn(['USER']).optional() // Companies can only create USER roles
];

const assignUserTestValidation = [
  body('userIds').isArray({ min: 1 }),
  body('testIds').isArray({ min: 1 })
];

// User validations
const updateProfileValidation = [
  nameValidation,
  body('email').optional().isEmail().normalizeEmail()
];

module.exports = {
  createCompanyValidation,
  assignTestValidation,
  createUserValidation,
  assignUserTestValidation,
  updateProfileValidation
};