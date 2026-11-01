/**
 * Content guardrails for the AI assistant.
 * Code-only. Provides:
 *  - input sanitization (strip prompt-injection attempts, cap length)
 *  - PII scrubbing for logging/storage
 *  - output moderation (flag harmful/unsafe content)
 *  - refusal templates
 */

const INPUT_MAX_CHARS = 2000;
const OUTPUT_MAX_CHARS = 20000;

const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|earlier)\b.{0,40}\b(instructions?|prompt|system|rules?|guidelines?|context)\b/i,
  /\byou are now\b/i,
  /\bact as (an?|the)?\s*(unrestricted|jailbroken|developer|admin|root|omniscient)\b/i,
  /\bnew instructions?[:\s]/i,
  /(?:^\s*|[\n\r]+)\s*<(system|assistant|user|im_start|im_end)\b/i,
  /\breveal.{0,40}(system|prompt|instructions?)\b/i,
  /\bdo not (follow|obey|respect)\b/i,
  /\/\*[\s\S]*?\*\//,
  /<script[\s\S]*?<\/script>/i
];

const PII_PATTERNS = [
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, label: '[email]' },
  { pattern: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?!\d)\b/g, label: '[phone]' },
  { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, label: '[card]' }
];

const MODERATION_PATTERNS = [
  { pattern: /\b(i will|I'll|let's|we should)\b.{0,80}\b(kill|hurt|attack|bomb|shoot|stab|poison|harm|rape|torture)\b/i, label: 'violence' },
  { pattern: /\b(kill|murder|rape|torture|bomb|shoot|stab|decapitat)\w*?\b.{0,80}\b(you|them|him|her|people|everyone|a (person|man|woman|child))\b/i, label: 'violence' },
  { pattern: /\b(fuck|shit|cunt|bitch|nigg\w+|fag\w+|retard)\b/i, label: 'profanity' }
];

/**
 * Sanitize a user question before it reaches the LLM / embedding / storage.
 * Strips injected instructions and enforces a length cap. Returns cleaned text.
 */
function sanitizeUserInput(input) {
  let text = String(input || '').trim();
  if (!text) return '';

  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, '');
  }

  text = text.replace(/<[^>]{0,200}>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, INPUT_MAX_CHARS);
}

/**
 * Scrub PII from a string for safe logging / display. Never modifies source data.
 */
function scrubPii(text) {
  if (!text) return text;
  let out = String(text);
  for (const { pattern, label } of PII_PATTERNS) {
    out = out.replace(pattern, label);
  }
  return out;
}

/**
 * Moderate generated output. Returns { flagged, label } when unsafe, else null.
 */
function moderateOutput(output) {
  const text = String(output || '');
  for (const { pattern, label } of MODERATION_PATTERNS) {
    if (pattern.test(text)) return { flagged: true, label };
  }
  return null;
}

/**
 * Does the user question reference sensitive identifiers (emails, phones, cards)?
 */
function hasPii(text) {
  return PII_PATTERNS.some(({ pattern }) => pattern.test(String(text || '')));
}

/**
 * A safe refusal when the answer cannot be grounded in available data.
 * Used when retrieval found no relevant evidence AND the question demands data.
 */
function noEvidenceRefusal(question) {
  return `I don't have enough data in the current dataset to answer "${String(question || '').slice(0, 120)}". I can only answer from the reports and metrics available here — try asking about what's in the data, or phrase the question differently.`;
}

module.exports = {
  sanitizeUserInput,
  scrubPii,
  moderateOutput,
  hasPii,
  noEvidenceRefusal,
  INPUT_MAX_CHARS,
  OUTPUT_MAX_CHARS
};