const settingsService = require('../../services/admin/settingsService');

async function getOpenAI(req, res, next) {
  try {
    const cfg = await settingsService.getOpenAIConfig();
    res.json(cfg);
  } catch (err) { next(err); }
}

async function updateOpenAI(req, res, next) {
  try {
    const { apiKey, model } = req.body || {};
    await settingsService.updateOpenAIConfig({ apiKey, model });
    const updated = await settingsService.getOpenAIConfig();
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { getOpenAI, updateOpenAI };
