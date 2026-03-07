const promptService = require('../services/promptService');

async function listPrompts(req, res, next) {
  try {
    const prompts = await promptService.listPrompts();
    return res.json(prompts);
  } catch (err) { next(err); }
}

async function getPrompt(req, res, next) {
  try {
    const prompt = await promptService.getPromptById(Number(req.params.id));
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    return res.json(prompt);
  } catch (err) { next(err); }
}

async function createPrompt(req, res, next) {
  try {
    const created = await promptService.createPrompt(req.body);
    return res.status(201).json(created);
  } catch (err) { next(err); }
}

async function updatePrompt(req, res, next) {
  try {
    const updated = await promptService.updatePrompt(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: 'Prompt not found' });
    return res.json(updated);
  } catch (err) { next(err); }
}

async function deletePrompt(req, res, next) {
  try {
    const ok = await promptService.deletePrompt(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Prompt not found' });
    return res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listPrompts, getPrompt, createPrompt, updatePrompt, deletePrompt };