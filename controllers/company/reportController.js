const reportService = require('../../services/company/reportService');
const logger = require('../../utils/logger');
const aiChat = require('../../services/aiChatOrchestrator');
const { sanitizeUserInput } = require('../../services/guardrailService');

async function getUserReports(req, res, next) {
  try {
    const reports = await reportService.getUserReports(req.user.companyId);
    res.json(reports);
  } catch (err) { next(err); }
}

async function getUserTestReport(req, res, next) {
  try {
    const report = await reportService.getUserTestReport(parseInt(req.params.userTestId), req.user.companyId);
    res.json(report);
  } catch (err) { next(err); }
}

async function getCompanyStats(req, res, next) {
  try {
    const stats = await reportService.getCompanyStats(req.user.companyId);
    res.json(stats);
  } catch (err) { next(err); }
}

async function getProblemSolutionOverview(req, res, next) {
  try {
    const { from, to, limit = 10 } = req.query;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const limitNum = parseInt(limit) || 10;
    
    const overview = await reportService.getProblemSolutionOverview(req.user.companyId, {
      from: fromDate,
      to: toDate,
      limit: limitNum
    });
    res.json(overview);
  } catch (err) { next(err); }
}

async function getLatestUserTestReportByUserId(req, res, next) {
  try {
    const userId = parseInt(req.params.userId);
    const result = await reportService.getLatestUserTestReportByUserId(req.user.companyId, userId);
    res.json(result);
  } catch (err) { next(err); }
}

async function getUpcomingDeadlines(req, res, next) {
  try {
    const rows = await reportService.getUpcomingDeadlines(req.user.companyId);
    res.json(rows);
  } catch (err) { next(err); }
}

async function queryCompanyData(req, res, next) {
  const startedAt = Date.now();
  try {
    const { question, history, conversationId } = req.body;
    const cleanQuestion = sanitizeUserInput(question);
    if (!cleanQuestion) {
      return res.status(400).json({ error: 'question is required' });
    }

    const scope = 'company';
    const { conversation, isNew } = await aiChat.resolveConversation({
      userId: req.user?.id,
      companyId: req.user.companyId,
      scope,
      conversationId,
      question: cleanQuestion
    });

    await aiChat.persistUserMessage(conversation.id, cleanQuestion);

    // Cache only context-free first questions.
    const cacheParams = {
      scope,
      companyId: req.user.companyId,
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
        companyId: req.user.companyId,
        durationMs: Date.now() - startedAt
      }, 'AI query served from cache');
      return res.json({ ...cached, conversationId: conversation.id, conversationTitle: conversation.title, cached: true });
    }

    const result = await reportService.queryCompanyData(req.user.companyId, cleanQuestion, req.user, history || []);

    // Output moderation (non-streaming can safely replace the answer).
    const moderated = aiChat.moderateAnswer(result?.answer);
    const finalResult = moderated.flagged ? { ...result, answer: moderated.answer, moderation: moderated.moderation } : result;

    await aiChat.persistAssistantMessage(conversation.id, finalResult);
    aiChat.cacheSet(cacheParams, finalResult);

    logger.info({
      event: 'ai_query.complete',
      scope,
      companyId: req.user.companyId,
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
      scope: 'company',
      companyId: req.user.companyId,
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

async function queryCompanyDataStream(req, res, next) {
  const startedAt = Date.now();
  try {
    const { question, history, conversationId } = req.body;
    const cleanQuestion = sanitizeUserInput(question);
    if (!cleanQuestion) {
      return res.status(400).json({ error: 'question is required' });
    }

    const scope = 'company';
    const { conversation, isNew } = await aiChat.resolveConversation({
      userId: req.user?.id,
      companyId: req.user.companyId,
      scope,
      conversationId,
      question: cleanQuestion
    });

    await aiChat.persistUserMessage(conversation.id, cleanQuestion);

    res.writeHead(200, SSE_HEADERS);
    // Flush headers immediately so the client knows the stream is live.
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const onAbort = () => res.end();
    req.on('close', onAbort);

    sseSend(res, 'meta', { status: 'started', conversationId: conversation.id, isNewConversation: isNew });

    // Cache: replay cached answer as a single chunk (context-free queries only).
    const cacheParams = {
      scope,
      companyId: req.user.companyId,
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
        companyId: req.user.companyId,
        durationMs: Date.now() - startedAt
      }, 'AI streaming query served from cache');
      return res.end();
    }

    const result = await reportService.queryCompanyData(
      req.user.companyId,
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
      companyId: req.user.companyId,
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
      scope: 'company',
      companyId: req.user.companyId,
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

const conversationStore = require('../../services/conversationStoreService');

async function getAiConversations(req, res, next) {
  try {
    const list = await conversationStore.listConversations({
      companyId: req.user.companyId,
      scope: 'company',
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
      companyId: req.user.companyId,
      scope: 'company'
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (err) { next(err); }
}

async function deleteAiConversation(req, res, next) {
  try {
    const deleted = await conversationStore.softDeleteConversation({
      id: parseInt(req.params.id),
      companyId: req.user.companyId,
      scope: 'company'
    });
    if (!deleted) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function getCompanyCKPIMetrics(req, res, next) {
  try {
    const metrics = await reportService.getCompanyCKPIMetrics(req.user.companyId);
    res.json(metrics);
  } catch (err) { next(err); }
}

async function getUserGlobalSummary(req, res, next) {
  try {
    const userId = parseInt(req.params.userId);
    const summary = await reportService.getUserGlobalSummary(userId);
    res.json({ summary });
  } catch (err) { next(err); }
}

module.exports = { 
  getUserReports, 
  getUserTestReport, 
  getCompanyStats,
  getProblemSolutionOverview,
  getUpcomingDeadlines,
  queryCompanyData,
  queryCompanyDataStream,
  getCompanyCKPIMetrics,
  getLatestUserTestReportByUserId,
  getUserGlobalSummary,
  getAiConversations,
  getAiConversation,
  deleteAiConversation
};
