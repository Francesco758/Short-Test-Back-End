const dashboardService = require('../../services/admin/dashboardService');
const logger = require('../../utils/logger');
const aiChat = require('../../services/aiChatOrchestrator');
const conversationStore = require('../../services/conversationStoreService');
const { sanitizeUserInput } = require('../../services/guardrailService');

function parseFilters(req) {
  const { period, ages, functions, orgSizes, orgTypes } = req.query;
  return {
    period: period || null,
    ages: ages ? ages.split(',').filter(Boolean) : null,
    functions: functions ? functions.split(',').filter(Boolean) : null,
    orgSizes: orgSizes ? orgSizes.split(',').filter(Boolean) : null,
    orgTypes: orgTypes ? orgTypes.split(',').filter(Boolean) : null
  };
}

async function getDashboardStats(req, res, next) {
  try {
    const filters = parseFilters(req);
    const stats = await dashboardService.getDashboardStats(filters);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

async function getRecentActivity(req, res, next) {
  try {
    const { limit = 10 } = req.query;
    const activity = await dashboardService.getRecentActivity(parseInt(limit));
    res.json(activity);
  } catch (err) {
    next(err);
  }
}

async function getCompanyPerformance(req, res, next) {
  try {
    const performance = await dashboardService.getCompanyPerformance();
    res.json(performance);
  } catch (err) {
    next(err);
  }
}

async function querySystemData(req, res, next) {
  const startedAt = Date.now();
  try {
    const { question, history, conversationId } = req.body;
    const cleanQuestion = sanitizeUserInput(question);
    if (!cleanQuestion) {
      return res.status(400).json({ error: 'question is required' });
    }

    const scope = 'admin';
    const { conversation, isNew } = await aiChat.resolveConversation({
      userId: req.user?.id,
      companyId: null,
      scope,
      conversationId,
      question: cleanQuestion
    });

    await aiChat.persistUserMessage(conversation.id, cleanQuestion);

    const cacheParams = {
      scope,
      companyId: null,
      userId: req.user?.id,
      question: cleanQuestion,
      history: history || []
    };
    const cached = aiChat.cacheGet(cacheParams);
    if (cached) {
      await aiChat.persistAssistantMessage(conversation.id, cached);
      logger.info({
        event: 'ai_query.cache_hit',
        scope,
        durationMs: Date.now() - startedAt
      }, 'AI query served from cache');
      return res.json({ ...cached, conversationId: conversation.id, conversationTitle: conversation.title, cached: true });
    }

    const result = await dashboardService.querySystemData(cleanQuestion, req.user, history || []);

    const moderated = aiChat.moderateAnswer(result?.answer);
    const finalResult = moderated.flagged ? { ...result, answer: moderated.answer, moderation: moderated.moderation } : result;

    await aiChat.persistAssistantMessage(conversation.id, finalResult);
    aiChat.cacheSet(cacheParams, finalResult);

    logger.info({
      event: 'ai_query.complete',
      scope,
      userId: req.user?.id,
      durationMs: Date.now() - startedAt,
      source: finalResult?.source,
      vectorEnriched: !!finalResult?.metadata?.vectorEnriched,
      intent: finalResult?.metadata?.intent,
      conversationId: conversation.id,
      isNewConversation: isNew,
      flagged: moderated.flagged
    }, 'AI query completed');
    res.json({ ...finalResult, conversationId: conversation.id, conversationTitle: conversation.title, cached: false });
  } catch (err) {
    logger.warn({
      event: 'ai_query.error',
      scope: 'global',
      userId: req.user?.id,
      durationMs: Date.now() - startedAt,
      err: err.message
    }, 'AI query failed');
    next(err);
  }
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no'
};

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function querySystemDataStream(req, res, next) {
  const startedAt = Date.now();
  try {
    const { question, history, conversationId } = req.body;
    const cleanQuestion = sanitizeUserInput(question);
    if (!cleanQuestion) {
      return res.status(400).json({ error: 'question is required' });
    }

    const scope = 'admin';
    const { conversation, isNew } = await aiChat.resolveConversation({
      userId: req.user?.id,
      companyId: null,
      scope,
      conversationId,
      question: cleanQuestion
    });

    await aiChat.persistUserMessage(conversation.id, cleanQuestion);

    res.writeHead(200, SSE_HEADERS);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const onAbort = () => res.end();
    req.on('close', onAbort);

    sseSend(res, 'meta', { status: 'started', conversationId: conversation.id, isNewConversation: isNew });

    const cacheParams = {
      scope,
      companyId: null,
      userId: req.user?.id,
      question: cleanQuestion,
      history: history || []
    };
    const cached = aiChat.cacheGet(cacheParams);
    if (cached) {
      if (typeof cached?.answer === 'string') {
        sseSend(res, 'chunk', { text: cached.answer });
      }
      await aiChat.persistAssistantMessage(conversation.id, cached);
      sseSend(res, 'done', {
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        cached: true,
        source: cached?.source,
        metadata: cached?.metadata,
        chartSpec: cached?.chartSpec || null,
        imageUrl: cached?.imageUrl || null,
        imageSize: cached?.imageSize || null
      });
      logger.info({
        event: 'ai_query.cache_hit',
        scope,
        durationMs: Date.now() - startedAt
      }, 'AI streaming query served from cache');
      return res.end();
    }

    const result = await dashboardService.querySystemData(
      cleanQuestion,
      req.user,
      history || [],
      (chunk) => sseSend(res, 'chunk', { text: chunk })
    );

    await aiChat.persistAssistantMessage(conversation.id, result);

    sseSend(res, 'done', {
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      cached: false,
      source: result?.source,
      metadata: result?.metadata,
      chartSpec: result?.chartSpec || null,
      imageUrl: result?.imageUrl || null,
      imageSize: result?.imageSize || null
    });

    aiChat.cacheSet(cacheParams, result);

    logger.info({
      event: 'ai_query.stream_complete',
      scope,
      userId: req.user?.id,
      durationMs: Date.now() - startedAt,
      source: result?.source,
      vectorEnriched: !!result?.metadata?.vectorEnriched,
      intent: result?.metadata?.intent,
      conversationId: conversation.id,
      isNewConversation: isNew
    }, 'AI streaming query completed');

    res.end();
  } catch (err) {
    logger.warn({
      event: 'ai_query.error',
      scope: 'global',
      userId: req.user?.id,
      durationMs: Date.now() - startedAt,
      err: err.message
    }, 'AI streaming query failed');
    if (res.headersSent) {
      try { sseSend(res, 'error', { error: err.message || 'Failed to get response' }); res.end(); } catch (e) {}
    } else {
      next(err);
    }
  }
}

async function getGlobalCKPIMetrics(req, res, next) {
  try {
    const filters = parseFilters(req);
    const metrics = await dashboardService.getGlobalCKPIMetrics(filters);
    res.json(metrics);
  } catch (err) {
    next(err);
  }
}

async function getGlobalCKPITrend(req, res, next) {
  try {
    const { days } = req.query;
    const filters = parseFilters(req);
    const trend = await dashboardService.getGlobalCKPITrend(days === 'all' ? 'all' : (days ? parseInt(days) : 30), filters);
    res.json(trend);
  } catch (err) {
    next(err);
  }
}

async function getProblemSolutionOverview(req, res, next) {
  try {
    const { companyId, from, to, limit } = req.query;
    const filters = parseFilters(req);
    const overview = await dashboardService.getProblemSolutionOverview({
      companyId: companyId ? parseInt(companyId) : null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      limit: limit ? parseInt(limit) : 10,
      filters
    });
    res.json(overview);
  } catch (err) {
    next(err);
  }
}

async function assignClusters(req, res, next) {
  try {
    const result = await dashboardService.assignClusters();
    res.json({ message: 'Clusters assigned', ...result });
  } catch (err) {
    next(err);
  }
}

async function getAiConversations(req, res, next) {
  try {
    const list = await conversationStore.listConversations({
      companyId: null,
      scope: 'admin',
      userId: req.user?.id,
      limit: 50
    });
    res.json(list);
  } catch (err) { next(err); }
}

async function getAiConversation(req, res, next) {
  try {
    const conversation = await conversationStore.getConversation({
      id: parseInt(req.params.id),
      companyId: null,
      scope: 'admin'
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (err) { next(err); }
}

async function deleteAiConversation(req, res, next) {
  try {
    const deleted = await conversationStore.softDeleteConversation({
      id: parseInt(req.params.id),
      companyId: null,
      scope: 'admin'
    });
    if (!deleted) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getCompanyPerformance,
  getGlobalCKPIMetrics,
  getGlobalCKPITrend,
  querySystemData,
  querySystemDataStream,
  getProblemSolutionOverview,
  assignClusters,
  getAiConversations,
  getAiConversation,
  deleteAiConversation
};
