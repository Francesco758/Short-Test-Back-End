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

async function getTransforMachine(req, res, next) {
  try {
    const data = await settingsService.getTransforMachinePrompt();
    res.json(data);
  } catch (err) { next(err); }
}

async function updateTransforMachine(req, res, next) {
  try {
    const { prompt } = req.body || {};
    await settingsService.updateTransforMachinePrompt({ prompt });
    const updated = await settingsService.getTransforMachinePrompt();
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { getOpenAI, updateOpenAI, getTransforMachine, updateTransforMachine };
