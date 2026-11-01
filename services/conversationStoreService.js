const { prisma } = require('../utils/prismaClient');

/**
 * Server-side persistence for DataChatbot conversations.
 * Additive-only design: creates AiConversation + AiConversationMessage rows.
 * Never deletes source data — "clear" is a soft delete (deletedAt).
 */

async function createConversation({ userId, companyId, scope, title }) {
  return prisma.aiConversation.create({
    data: {
      userId: userId || null,
      companyId: companyId || null,
      scope: scope || 'company',
      title: String(title || 'AI Conversation').slice(0, 200)
    }
  });
}

async function listConversations({ companyId, scope, userId, limit = 50 }) {
  const where = { deletedAt: null, scope: scope || 'company' };
  if (companyId) where.companyId = companyId;
  if (userId) where.userId = userId;

  return prisma.aiConversation.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      userId: true,
      companyId: true,
      scope: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: { where: { role: 'user' } } } }
    }
  });
}

async function getConversation({ id, companyId, scope }) {
  const where = { id, deletedAt: null };
  if (companyId) where.companyId = companyId;
  if (scope) where.scope = scope;

  const conv = await prisma.aiConversation.findFirst({
    where,
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          source: true,
          chartSpec: true,
          imageUrl: true,
          imageSize: true,
          metadata: true,
          createdAt: true
        }
      }
    }
  });
  return conv;
}

async function appendMessage({ conversationId, role, content, source = null, chartSpec = null, imageUrl = null, imageSize = null, metadata = null }) {
  if (!content && !chartSpec && !imageUrl) return null;

  const [msg] = await Promise.all([
    prisma.aiConversationMessage.create({
      data: {
        conversationId,
        role,
        content: String(content || ''),
        source,
        chartSpec: chartSpec || undefined,
        imageUrl: imageUrl || null,
        imageSize: imageSize || null,
        metadata: metadata || undefined
      }
    }),
    prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    })
  ]);
  return msg;
}

async function softDeleteConversation({ id, companyId, scope }) {
  const where = { id, deletedAt: null };
  if (companyId) where.companyId = companyId;
  if (scope) where.scope = scope;

  const conv = await prisma.aiConversation.findFirst({ where });
  if (!conv) return null;

  return prisma.aiConversation.update({
    where: { id: conv.id },
    data: { deletedAt: new Date() }
  });
}

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  appendMessage,
  softDeleteConversation
};