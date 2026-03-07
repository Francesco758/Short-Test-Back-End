const userService = require('../../services/company/userService');

async function createUser(req, res, next) {
  try {
    const user = await userService.createUser({ ...req.body, companyId: req.user.companyId });
    res.status(201).json(user);
  } catch (err) { next(err); }
}

async function getCompanyUsers(req, res, next) {
  try {
    const users = await userService.getCompanyUsers(req.user.companyId);
    res.json(users);
  } catch (err) { next(err); }
}

async function updateUser(req, res, next) {
  try {
    const user = await userService.updateUser(parseInt(req.params.id), req.body, req.user.companyId);
    res.json(user);
  } catch (err) { next(err); }
}

async function deleteUser(req, res, next) {
  try {
    await userService.deleteUser(parseInt(req.params.id), req.user.companyId);
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
}

async function bulkCreateUsers(req, res, next) {
  try {
    const result = await userService.bulkCreateUsers(req.body.users, req.user.companyId);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

module.exports = { createUser, getCompanyUsers, updateUser, deleteUser, bulkCreateUsers };