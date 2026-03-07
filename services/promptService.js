const { prisma } = require('../utils/prismaClient');

// Only keep functions needed for external prompt management
// The conversation system now uses testService directly

async function listPrompts() {
  const prompts = await prisma.prompt.findMany({
    orderBy: [{ testId: 'asc' }, { phase: 'asc' }, { id: 'asc' }],
    include: { test: { select: { id: true, title: true } } } // Include test info
  });
  return prompts;
}

async function getPromptById(id) {
  if (!Number.isInteger(id)) return null;
  const p = await prisma.prompt.findUnique({ 
    where: { id },
    include: { test: { select: { id: true, title: true } } }
  });
  return p;
}

// Remove getPromptByKeyAndTest - now handled by testService
// Remove getPromptByKey - not needed
// Remove findPromptByPhase - not needed

async function createPrompt(payload) {
  if (!payload.key || !payload.content || !payload.testId) {
    const err = new Error('key, content, and testId are required');
    err.status = 400;
    throw err;
  }

  // Verify test exists
  const test = await prisma.test.findUnique({
    where: { id: payload.testId, deletedAt: null }
  });
  
  if (!test) {
    const err = new Error('Test not found');
    err.status = 404;
    throw err;
  }

  // Check for duplicate key in same test
  const existing = await prisma.prompt.findFirst({ 
    where: { key: payload.key, testId: payload.testId } 
  });
  if (existing) {
    const err = new Error('Prompt key already exists for this test');
    err.status = 409;
    throw err;
  }

  const created = await prisma.prompt.create({
    data: {
      key: payload.key,
      phase: payload.phase ?? null,
      title: payload.title ?? null,
      content: payload.content,
      testId: payload.testId
    },
    include: { test: { select: { id: true, title: true } } }
  });

  return created;
}

async function updatePrompt(id, data) {
  if (!Number.isInteger(id)) return null;

  const found = await prisma.prompt.findUnique({ 
    where: { id },
    include: { test: true }
  });
  if (!found) return null;

  if (data.key && data.key !== found.key) {
    const other = await prisma.prompt.findFirst({ 
      where: { key: data.key, testId: found.testId } 
    });
    if (other) {
      const err = new Error('Prompt key already exists for this test');
      err.status = 409;
      throw err;
    }
  }

  const updated = await prisma.prompt.update({
    where: { id },
    data: {
      key: data.key ?? found.key,
      phase: typeof data.phase === 'number' ? data.phase : found.phase,
      title: data.title ?? found.title,
      content: typeof data.content === 'string' ? data.content : found.content
    },
    include: { test: { select: { id: true, title: true } } }
  });

  return updated;
}

async function deletePrompt(id) {
  if (!Number.isInteger(id)) return false;
  const found = await prisma.prompt.findUnique({ where: { id } });
  if (!found) return false;
  await prisma.prompt.delete({ where: { id } });
  return true;
}

module.exports = {
  listPrompts,
  getPromptById,
  createPrompt,
  updatePrompt,
  deletePrompt
};