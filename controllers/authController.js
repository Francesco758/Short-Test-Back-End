const authService = require('../services/authService');

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) { 
    next(err); 
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    if (result.token) res.setHeader('Authorization', `Bearer ${result.token}`);
    res.json(result);
  } catch (err) { 
    next(err); 
  }
}

async function me(req, res, next) {
  try {
    res.json({ user: req.user });
  } catch (err) { 
    next(err); 
  }
}

async function changePassword(req, res, next) {
  try {
    const result = await authService.changePassword(req.user.id, req.body);
    res.json(result);
  } catch (err) { 
    next(err); 
  }
}

async function guestLogin(req, res, next) {
  try {
    const result = await authService.guestLogin(req.body);
    if (result.token) res.setHeader('Authorization', `Bearer ${result.token}`);
    res.json(result);
  } catch (err) { 
    next(err); 
  }
}

module.exports = { 
  register, 
  login, 
  me, 
  changePassword,
  guestLogin
};