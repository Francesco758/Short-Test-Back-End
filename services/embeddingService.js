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

async function searchSimilarReports(companyId, query, { type, limit = 5, threshold = 0.4 } = {}) {
  const { prisma } = require('../utils/prismaClient');
  const queryEmbedding = await generateEmbedding(query);

  const where = { companyId };
  if (type) where.type = type;

  const embeddings = await prisma.reportEmbedding.findMany({ where });
  if (!embeddings.length) return [];

  const results = embeddings.map(e => ({
    reportId: e.reportId,
    key: e.key,
    topic: e.topic,
    type: e.type,
    summary: e.summary,
    similarity: cosineSimilarity(queryEmbedding, JSON.parse(e.embedding))
  }));

  return results
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

async function ensureReportEmbeddings(companyId) {
  const { prisma } = require('../utils/prismaClient');

  const whereFilter = companyId ? { userTest: { companyId } } : {};
  const reports = await prisma.report.findMany({
    where: whereFilter,
    select: { id: true, detailedAnalysis: true }
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
  }

  if (!candidates.length) return;

  const existing = await prisma.reportEmbedding.findMany({
    where: { companyId },
    select: { reportId: true, type: true }
  });
  const existingSet = new Set(existing.map(e => `${e.reportId}:${e.type}`));

  const missing = candidates.filter(c => !existingSet.has(`${c.reportId}:${c.type}`));
  if (!missing.length) return;

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

module.exports = { generateEmbedding, cosineSimilarity, searchSimilarReports, ensureReportEmbeddings };
