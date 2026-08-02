const { prisma } = require('../../utils/prismaClient');

const OPENAI_API_KEY_KEY = 'openai_api_key';
const OPENAI_MODEL_KEY = 'openai_model';
const TRANSFORMACHINE_PROMPT_KEY = 'transformachine_prompt';

async function getOpenAIConfig() {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: [OPENAI_API_KEY_KEY, OPENAI_MODEL_KEY] } }
  });
  const map = Object.fromEntries(settings.map(s => [s.key, s.value]));
  const apiKey = map[OPENAI_API_KEY_KEY] || process.env.OPENAI_API_KEY || '';
  const model = map[OPENAI_MODEL_KEY] || process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini';
  return {
    apiKey,
    apiKeyPreview: apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : '',
    model
  };
}

async function updateOpenAIConfig({ apiKey, model }) {
  const ops = [];
  if (apiKey && typeof apiKey === 'string') {
    ops.push(prisma.systemSetting.upsert({
      where: { key: OPENAI_API_KEY_KEY },
      update: { value: apiKey },
      create: { key: OPENAI_API_KEY_KEY, value: apiKey }
    }));
  }
  if (model && typeof model === 'string') {
    ops.push(prisma.systemSetting.upsert({
      where: { key: OPENAI_MODEL_KEY },
      update: { value: model },
      create: { key: OPENAI_MODEL_KEY, value: model }
    }));
  }
  await prisma.$transaction(ops);
  return { ok: true };
}

async function getTransforMachinePrompt() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: TRANSFORMACHINE_PROMPT_KEY }
  });
  return {
    prompt: setting?.value || ''
  };
}

async function updateTransforMachinePrompt({ prompt }) {
  if (prompt && typeof prompt === 'string') {
    await prisma.systemSetting.upsert({
      where: { key: TRANSFORMACHINE_PROMPT_KEY },
      update: { value: prompt.trim() },
      create: { key: TRANSFORMACHINE_PROMPT_KEY, value: prompt.trim() }
    });
  } else {
    // If empty string, delete the setting
    try {
      await prisma.systemSetting.delete({
        where: { key: TRANSFORMACHINE_PROMPT_KEY }
      });
    } catch {
      // Ignore if not found
    }
  }
  return { ok: true };
}

module.exports = { getOpenAIConfig, updateOpenAIConfig, getTransforMachinePrompt, updateTransforMachinePrompt };
