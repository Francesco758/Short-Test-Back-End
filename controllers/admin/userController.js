const userService = require('../../services/admin/userService');

async function createUser(req, res, next) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

async function getAllUsers(req, res, next) {
  try {
    const { page = 1, limit = 10, role, companyId, search } = req.query;
    const users = await userService.getAllUsers({ page, limit, role, companyId, search });
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function getUserById(req, res, next) {
  try {
    const user = await userService.getUserById(parseInt(req.params.id));
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await userService.updateUser(parseInt(req.params.id), req.body);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function deleteUser(req, res, next) {
  try {
    await userService.deleteUser(parseInt(req.params.id));
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
}

async function bulkCreateUsers(req, res, next) {
  try {
    const result = await userService.bulkCreateUsers(req.body.users);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  bulkCreateUsers
};