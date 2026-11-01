const EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
let _cfg = { apiKey: process.env.OPENAI_API_KEY || '', loadedAt: 0 };

async function loadConfig() {
  const now = Date.now();
  if (now - _cfg.loadedAt < 30000 && _cfg.apiKey) return;
  try {
    const { prisma } = require('../utils/prismaClient');
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'openai_api_key' } });
    if (setting?.value) _cfg.apiKey = setting.value;
    _cfg.loadedAt = now;
  } catch { /* use defaults */ }
}

async function generateEmbedding(text) {
  await loadConfig();
  if (!_cfg.apiKey) throw new Error('OpenAI API key not configured');
  const resp = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  return data.data[0].embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Tokenize a string into lowercased keyword tokens (with basic stemming-lite cleanup).
 */
function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Lightweight BM25-style keyword score: how many query tokens appear in the chunk's
 * summary/topic, weighted by term frequency. Cheap, deterministic, complements vector search.
 */
function keywordScore(query, summary, topic = '') {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const docText = `${summary} ${topic}`.toLowerCase();
  let hits = 0;
  for (const t of qTokens) {
    const regex = new RegExp(`\\b${t}`, 'i');
    if (regex.test(docText)) hits += 1;
  }
  return hits / qTokens.length;
}

const CKPI_COMPONENT_LABELS = {
  simplification: 'Simplification',
  originality: 'Originality',
  feasibility: 'Feasibility',
  criticalThinking: 'Critical Thinking',
  proactivity: 'Proactivity',
  impact: 'Impact',
  creativity: 'Creativity'
};

/**
 * Build a conversation-aware retrieval query.
 * When the user is following up ("what about the proactivity issue?"), prepend the
 * last assistant answer so the embedding model can disambiguate pronouns/topic.
 */
function buildRetrievalQuery(question, history = []) {
  if (!Array.isArray(history) || history.length === 0) return question;
  const lastAssistant = [...history].reverse().find(m => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.trim());
  if (!lastAssistant) return question;
  const excerpt = lastAssistant.content.trim().slice(-400);
  return `Context: ${excerpt}\n\nQuestion: ${question}`;
}

/**
 * Build a CKPI evaluation narrative from a report's KPI payload + overall summary.
 * Used as the "ckpi" chunk type so retrieval can answer "how well did the user do",
 * strengths/weaknesses, and specific component scores.
 */
function buildCkpiChunkText(kpis, summary) {
  if (!kpis || typeof kpis !== 'object') return null;
  const components = kpis.components || {};
  const lines = [];

  const finalScore = Number(kpis.final);
  if (Number.isFinite(finalScore)) {
    lines.push(`Overall CKPI score: ${Math.round(finalScore)}%.`);
  }

  const scored = [];
  for (const [key, label] of Object.entries(CKPI_COMPONENT_LABELS)) {
    const val = components[key];
    if (typeof val === 'number' && Number.isFinite(val)) scored.push(`${label}: ${Math.round(val)}%`);
  }
  if (scored.length) lines.push(`Component scores — ${scored.join(', ')}.`);

  const strengths = Array.isArray(kpis.strengths) ? kpis.strengths.filter(s => typeof s === 'string' && s.trim()) : [];
  if (strengths.length) lines.push(`Strengths: ${strengths.slice(0, 5).join('; ')}.`);

  const improvements = Array.isArray(kpis.improvements) ? kpis.improvements.filter(i => typeof i === 'string' && i.trim()) : [];
  if (improvements.length) lines.push(`Areas for improvement: ${improvements.slice(0, 5).join('; ')}.`);

  if (typeof summary === 'string' && summary.trim()) lines.push(`Summary: ${summary.trim()}`);

  const text = lines.join('\n').trim();
  return text.length > 10 ? text : null;
}

/**
 * Hybrid semantic + keyword search over stored report embeddings.
 *
 * - `companyId` — a specific company scope.
 * - `companyId === null` — global scope (all companies with embeddings). NOTE: this
 *   intentionally searches ALL companies, so admin dashboards can surface cross-company
 *   patterns. Previously `where: { companyId: null }` matched nothing.
 *
 * Returns reranked candidates with combined `score` (0..1) alongside vector `similarity`.
 */
async function searchSimilarReports(companyId, query, { type, limit = 5, threshold = 0.4, rerank = false } = {}) {
  const { prisma } = require('../utils/prismaClient');
  const queryEmbedding = await generateEmbedding(query);

  const where = {};
  if (companyId) where.companyId = companyId;
  if (type) where.type = type;

  const embeddings = await prisma.reportEmbedding.findMany({ where });
  if (!embeddings.length) return [];

  const results = embeddings.map(e => {
    const vectorSim = cosineSimilarity(queryEmbedding, JSON.parse(e.embedding));
    const kwSim = keywordScore(query, e.summary, e.topic);
    // Weighted hybrid: vector dominates, keyword boosts exact-term matches.
    const score = vectorSim * 0.7 + kwSim * 0.3;
    return {
      reportId: e.reportId,
      key: e.key,
      topic: e.topic,
      type: e.type,
      summary: e.summary,
      similarity: vectorSim,
      keywordScore: kwSim,
      score
    };
  });

  const hybrid = results
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

  // Optional LLM cross-encoder-style rerank: pull a larger candidate window (top 20),
  // let the model re-order by relevance to the question, keep top `limit`.
  if (rerank && hybrid.length > 2) {
    try {
      const { rerankCandidates } = require('./gptService');
      const topWindow = hybrid.slice(0, 20);
      const reranked = await rerankCandidates({ question: query, candidates: topWindow, topK: limit });
      if (Array.isArray(reranked) && reranked.length) {
        // Preserve full metadata for entries the model kept; drop the rest.
        return reranked.map(r => topWindow.find(t => t === r)).filter(Boolean);
      }
    } catch (err) {
      console.warn('[Embedding] Rerank unavailable, using hybrid order:', err.message);
    }
  }

  return hybrid.slice(0, limit);
}

async function ensureReportEmbeddings(companyId) {
  const { prisma } = require('../utils/prismaClient');

  const whereFilter = companyId ? { userTest: { companyId } } : {};
  const reports = await prisma.report.findMany({
    where: whereFilter,
    select: { id: true, summary: true, kpis: true, detailedAnalysis: true }
  });

  const candidates = [];

  for (const r of reports) {
    const da = r.detailedAnalysis || {};
    const pKey = da.problem_key;
    const pSummary = da.problem_summary;
    const pTopic = da.problem_topic || da.problem_cluster;
    if (pKey && pSummary && typeof pSummary === 'string' && pSummary.length > 10) {
      candidates.push({ reportId: r.id, key: pKey, topic: pTopic || pKey, type: 'problem', summary: pSummary });
    }
    const sKey = da.solution_key;
    const sSummary = da.solution_summary;
    const sTopic = da.solution_topic || da.solution_cluster;
    if (sKey && sSummary && typeof sSummary === 'string' && sSummary.length > 10) {
      candidates.push({ reportId: r.id, key: sKey, topic: sTopic || sKey, type: 'solution', summary: sSummary });
    }

    // CKPI evaluation narrative: derived from the report's KPI components + strengths +
    // improvements + overall summary. Gives retrieval access to "how well did the user do".
    const ckpiText = buildCkpiChunkText(r.kpis, r.summary);
    if (ckpiText) {
      candidates.push({ reportId: r.id, key: 'ckpi_evaluation', topic: 'CKPI evaluation', type: 'ckpi', summary: ckpiText });
    }

    // Conversation summary: what was discussed during the assessment.
    const convSummary = da.conversationSummary;
    if (convSummary && typeof convSummary === 'string' && convSummary.trim().length > 10) {
      candidates.push({ reportId: r.id, key: 'conversation', topic: 'Conversation summary', type: 'conversation', summary: convSummary.trim() });
    }
  }

  if (!candidates.length) return;

  const existing = await prisma.reportEmbedding.findMany({
    where: { companyId },
    select: { id: true, reportId: true, type: true, summary: true }
  });
  const existingByKey = new Map(existing.map(e => [`${e.reportId}:${e.type}`, e]));

  // --- Upsert: create missing, update changed summaries (NEVER delete source data) ---
  const missing = [];
  const changed = [];
  for (const c of candidates) {
    const key = `${c.reportId}:${c.type}`;
    const old = existingByKey.get(key);
    if (!old) {
      missing.push(c);
    } else if (old.summary !== c.summary) {
      changed.push({ ...c, id: old.id });
    }
  }

  // Create new embeddings
  if (missing.length) {
    const batchSize = 20;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const texts = batch.map(item => item.summary);
      const embeddings = await Promise.all(texts.map(t => generateEmbedding(t)));

      await prisma.reportEmbedding.createMany({
        data: batch.map((item, idx) => ({
          companyId,
          reportId: item.reportId,
          key: item.key,
          type: item.type,
          topic: item.topic,
          summary: item.summary,
          embedding: JSON.stringify(embeddings[idx])
        })),
        skipDuplicates: true
      });
    }
  }

  // Update changed summaries (re-embed)
  if (changed.length) {
    const batchSize = 20;
    for (let i = 0; i < changed.length; i += batchSize) {
      const batch = changed.slice(i, i + batchSize);
      const texts = batch.map(item => item.summary);
      const embeddings = await Promise.all(texts.map(t => generateEmbedding(t)));

      await Promise.all(batch.map((item, idx) =>
        prisma.reportEmbedding.update({
          where: { id: item.id },
          data: {
            key: item.key,
            topic: item.topic,
            summary: item.summary,
            embedding: JSON.stringify(embeddings[idx])
          }
        })
      ));
    }
  }

  return { created: missing.length, updated: changed.length };
}

module.exports = { generateEmbedding, cosineSimilarity, searchSimilarReports, ensureReportEmbeddings, buildRetrievalQuery };
