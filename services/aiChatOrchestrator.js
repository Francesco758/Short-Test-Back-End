const { prisma } = require('../utils/prismaClient');
const conversationStore = require('./conversationStoreService');
const queryCache = require('./queryCacheService');
const guardrails = require('./guardrailService');

/**
 * Shared orchestration for AI chat endpoints (company + admin, stream + non-stream).
 * Responsibilities: sanitize input, resolve/persist conversations, cache, moderate output.
 * All persistence is additive — nothing is ever deleted.
 */

function isContextFree(history) {
  return !Array.isArray(history) || history.length === 0;
}

async function resolveConversation({ userId, companyId, scope, conversationId, question }) {
  if (conversationId) {
    const existing = await prisma.aiConversation.findFirst({
      where: { id: Number(conversationId), deletedAt: null }
    });
    if (existing) return { conversation: existing, isNew: false };
  }

  const conversation = await conversationStore.createConversation({
    userId: userId || null,
    companyId: companyId || null,
    scope: scope || 'company',
    title: question ? String(question).slice(0, 80) : 'AI Conversation'
  });
  return { conversation, isNew: true };
}

async function persistUserMessage(conversationId, question) {
  return conversationStore.appendMessage({
    conversationId,
    role: 'user',
    content: question
  });
}

async function persistAssistantMessage(conversationId, result) {
  return conversationStore.appendMessage({
    conversationId,
    role: 'assistant',
    content: result?.answer || '',
    source: result?.source || null,
    chartSpec: result?.chartSpec || null,
    imageUrl: result?.imageUrl || null,
    imageSize: result?.imageSize || null,
    metadata: result?.metadata || null
  });
}

function cacheKeyFor({ scope, companyId, userId, question, history }) {
  return {
    scope,
    companyId: companyId || null,
    userId: userId || null,
    question,
    historyLength: isContextFree(history) ? 0 : 1
  };
}

function cacheGet(params) {
  return queryCache.get(cacheKeyFor(params));
}

function cacheSet(params, value) {
  queryCache.set(cacheKeyFor(params), value);
}

/**
 * Moderate a final answer. If flagged (and not streaming), replace with a safe refusal.
 */
function moderateAnswer(answer) {
  const moderation = guardrails.moderateOutput(answer);
  if (!moderation) return { answer, flagged: false };
  return {
    answer: `I can't provide that response. If you'd like, rephrase your question about the team's data.`,
    flagged: true,
    moderation: moderation.label
  };
}

function evidenceAvailability({ vectorEnriched, hasDeterministic, hasSemantic }) {
  const grounded = !!vectorEnriched || hasDeterministic || hasSemantic;
  return { grounded };
}

module.exports = {
  isContextFree,
  resolveConversation,
  persistUserMessage,
  persistAssistantMessage,
  cacheKeyFor,
  cacheGet,
  cacheSet,
  moderateAnswer,
  evidenceAvailability
};