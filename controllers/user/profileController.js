const profileService = require('../../services/user/profileController');

async function getProfile(req, res, next) {
  try {
    const profile = await profileService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) { next(err); }
}

async function updateProfile(req, res, next) {
  try {
    const profile = await profileService.updateProfile(req.user.id, req.body);
    res.json(profile);
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    await profileService.changePassword(req.user.id, req.body);
    res.json({ message: 'Password updated successfully' });
  } catch (err) { next(err); }
}

module.exports = { getProfile, updateProfile, changePassword };