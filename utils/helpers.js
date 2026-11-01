function formatResponse(data, message = 'Success', status = 200) {
  return {
    status,
    message,
    data,
    timestamp: new Date().toISOString()
  };
}

function paginateResults(results, page, limit, total) {
  return {
    data: results,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  };
}

function calculateAverageKPI(reports) {
  if (!reports.length) return 0;
  const sum = reports.reduce((total, report) => {
    // Prefer explicit final value when available
    if (typeof report.kpis?.final === 'number') return total + report.kpis.final;

    // Otherwise derive from components (supporting 6 params, fall back to 0 when missing)
    const comps = report.kpis?.components || {};
    const vals = [
      Number.isFinite(comps.simplification) ? comps.simplification : (Number.isFinite(comps.simplify) ? comps.simplify : 0),
      Number.isFinite(comps.originality) ? comps.originality : (Number.isFinite(comps.creativity) ? comps.creativity : 0),
      Number.isFinite(comps.feasibility) ? comps.feasibility : 0,
      Number.isFinite(comps.criticalThinking) ? comps.criticalThinking : 0,
      Number.isFinite(comps.proactivity) ? comps.proactivity : 0,
      Number.isFinite(comps.impact) ? comps.impact : 0
    ];
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return total + avg;
  }, 0);
  return Math.round(sum / reports.length);
}

function formatTime(seconds) {
  if (!seconds) return '0m';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function generateRandomPassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Launch attribution helpers.
 *
 * These support the self-serve "Start a shorTest" feature: it can be triggered
 * from the platform itself or, in the future, from external systems
 * (Teams, Outlook, browser extensions, intranets). The originating system
 * (`source`) and an optional `context` (e.g. an email subject, an email body,
 * a Teams message or the selected text) are stored on TestAttempt.metadata,
 * which is an existing JSON column — no schema migration required.
 */

const LAUNCH_CONTEXT_MAX_LENGTH = 2000;
const DEFAULT_LAUNCH_SOURCE = 'web';

function normalizeLaunchSource(source) {
  const value = String(source === undefined || source === null ? '' : source)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return (value || DEFAULT_LAUNCH_SOURCE).slice(0, 40);
}

function normalizeLaunchContext(context) {
  if (context === undefined || context === null) return null;
  try {
    const text = typeof context === 'string' ? context.trim() : JSON.stringify(context);
    if (!text || text === 'null' || text === '""' || text === '{}') return null;
    return text.length > LAUNCH_CONTEXT_MAX_LENGTH ? text.slice(0, LAUNCH_CONTEXT_MAX_LENGTH) : text;
  } catch {
    return null;
  }
}

function hasLaunchSource(source) {
  return source !== undefined && source !== null && String(source).trim() !== '';
}

/**
 * Build the metadata payload for a test attempt.
 * Returns null when neither `source` nor a usable `context` was provided, so
 * existing callers keep byte-identical behaviour.
 */
function buildLaunchMetadata({ source, context } = {}) {
  const normalizedContext = normalizeLaunchContext(context);
  const provided = hasLaunchSource(source) || normalizedContext !== null;
  if (!provided) return null;

  return {
    launch: {
      source: normalizeLaunchSource(source),
      context: normalizedContext,
      at: new Date().toISOString()
    }
  };
}

module.exports = {
  formatResponse,
  paginateResults,
  calculateAverageKPI,
  formatTime,
  generateRandomPassword,
  normalizeLaunchSource,
  normalizeLaunchContext,
  buildLaunchMetadata
};