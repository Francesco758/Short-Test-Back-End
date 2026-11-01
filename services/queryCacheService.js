/**
 * In-memory query cache for AI answers.
 * Code-only (no schema change). Keyed by scope + company + normalized question.
 * Only caches context-free queries (empty history) to avoid leaking multi-turn context.
 * TTL-based eviction + LRU capacity bound.
 */

const MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map();

function normalize(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey({ scope, companyId, userId, question }) {
  return `${scope}:${companyId || 'g'}:${userId || 'u'}:${normalize(question)}`;
}

function get({ scope, companyId, userId, question, historyLength }) {
  // Never serve cache for multi-turn queries (context matters).
  if (historyLength > 0) return null;

  const key = makeKey({ scope, companyId, userId, question });
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  // Refresh recency (LRU).
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function set({ scope, companyId, userId, question, historyLength }, value, ttlMs = DEFAULT_TTL_MS) {
  if (historyLength > 0) return;
  const key = makeKey({ scope, companyId, userId, question });

  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });

  // Bound the map: evict oldest entries when over capacity.
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function clear() {
  cache.clear();
}

module.exports = { get, set, clear };