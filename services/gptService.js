const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const { prisma } = require('../utils/prismaClient');
const { recordUsage } = require('./usageService');

const OPENAI_API_KEY_KEY = 'openai_api_key';
const OPENAI_MODEL_KEY = 'openai_model';
let _cfg = {
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
  loadedAt: 0
};

async function loadConfigIfStale() {
  const now = Date.now();
  if (now - _cfg.loadedAt < 10_000 && _cfg.apiKey) return _cfg;
  
  try {
    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: [OPENAI_API_KEY_KEY, OPENAI_MODEL_KEY] } }
    });
    const map = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
    _cfg.apiKey = map[OPENAI_API_KEY_KEY] || _cfg.apiKey;
    _cfg.model = map[OPENAI_MODEL_KEY] || _cfg.model;
    _cfg.loadedAt = now;
  } catch (err) {
    console.error('[GPT Service] Failed to load config from DB:', err.message);
    // If it's a connection error, we just keep using the existing _cfg (from .env or previous load)
    if (!_cfg.apiKey) {
      console.warn('[GPT Service] No API key available and DB load failed.');
    }
  }
  return _cfg;
}

if (!_cfg.apiKey) {
  console.warn('Warning: OPENAI_API_KEY is not set. GPT endpoints will fail until you set it.');
}

/**
 * Fetch wrapper with timeout support.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // If caller provided a signal, link it so aborting that signal also aborts ours
  if (options.signal) {
    try {
      options.signal.addEventListener('abort', () => controller.abort());
    } catch (e) {}
  }

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Fetch with retries and exponential backoff for transient network errors.
 */
async function fetchWithRetries(url, options = {}, { retries = 2, timeoutMs = 30000, retryDelay = 1000 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > retries) break;
      const delay = retryDelay * Math.pow(2, attempt - 1);
      console.warn(`[GPT] Fetch attempt ${attempt} failed, retrying in ${delay}ms:`, err.message || err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/**
 * Create a safe, summarized string for tool outputs to send to the assistant.
 * Large binary or data-URI payloads are trimmed to avoid inflating token usage.
 */
function summarizeToolOutput(output) {
  try {
    if (!output) return '';
    if (typeof output === 'string') {
      if (output.length > 2000) return output.slice(0, 1000) + '...[truncated]';
      return output;
    }

    // If it's an object, shallow-copy and redact large fields
    const copy = {};
    for (const k of Object.keys(output)) {
      const v = output[k];
      if ((k === 'b64_json' || k === 'b64' || k === 'data') && typeof v === 'string') {
        copy[k] = `<omitted base64 length:${v.length}>`;
        continue;
      }
      if (k === 'url' && typeof v === 'string') {
        if (v.length > 2000 || v.startsWith('data:')) {
          copy.url = `<omitted url length:${v.length}>`;
          continue;
        }
      }
      // Keep small primitives and short strings
      if (typeof v === 'string' && v.length > 1000) {
        copy[k] = v.slice(0, 500) + '...[truncated]';
      } else {
        copy[k] = v;
      }
    }
    return JSON.stringify(copy);
  } catch (e) {
    return String(output).slice(0, 1000) + '...[summarize-failed]';
  }
}

async function streamChatCompletion({ model = 'gpt-4o-mini', messages = [], temperature = 0.7, onChunk, onDone, onError, context, onUsage }) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) {
    const err = new Error('OPENAI_API_KEY not configured');
    if (onError) onError(err);
    throw err;
  }

  const body = { model: model || _cfg.model, messages, temperature, stream: true, stream_options: { include_usage: true } };

  const res = await fetchWithRetries(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_cfg.apiKey}`
    },
    body: JSON.stringify(body)
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`OpenAI stream error: ${res.status} ${text}`);
    if (onError) onError(err);
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let done = false;
  let buffer = '';

  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\n/);
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) {
            const usageData = {
              promptTokens: parsed.usage.prompt_tokens || 0,
              completionTokens: parsed.usage.completion_tokens || 0,
              totalTokens: parsed.usage.total_tokens || 0,
              model: model || _cfg.model,
            };
            if (onUsage) onUsage(usageData);
            if (context) {
              recordUsage({ ...context, model: model || _cfg.model, promptTokens: usageData.promptTokens, completionTokens: usageData.completionTokens, totalTokens: usageData.totalTokens, endpoint: 'streamChatCompletion' });
            }
            if (onDone) onDone();
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta && onChunk) onChunk(delta);
        } catch (e) {}
      }
    }
  }

  if (onDone) onDone();
}

async function evaluateAnswer({ model = 'gpt-4o-mini', messages = [], temperature = 0.0, max_tokens = 300, context }) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) throw new Error('OPENAI_API_KEY not configured');

  const body = { model: model || _cfg.model, messages, temperature, max_tokens, stream: false };

  const res = await fetchWithRetries(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify(body)
  }, { retries: 2, timeoutMs: 30000 });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI eval error: ${res.status} ${text}`);
  }

  const payload = await res.json();
  const assistant = payload.choices?.[0]?.message?.content || '';

  if (payload.usage && context) {
    recordUsage({ ...context, model: model || _cfg.model, promptTokens: payload.usage.prompt_tokens || 0, completionTokens: payload.usage.completion_tokens || 0, totalTokens: payload.usage.total_tokens || 0, endpoint: 'evaluateAnswer' });
  }

  const jsonStart = assistant.indexOf('{');
  const jsonText = jsonStart >= 0 ? assistant.slice(jsonStart) : assistant;

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    const match = assistant.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('Failed to parse evaluation JSON from assistant response');
      }
    }
    throw new Error('Evaluation did not return JSON');
  }
}

/**
 * Non-stream Chat Completion with tool calling support.
 * Automatically executes tool calls and returns final assistant content plus any tool outputs.
 */
async function runChatWithTools({
  model = process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini',
  messages = [],
  temperature = 0.7,
  tools = defaultTools(),
  maxIterations = 8,
  context
}) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) throw new Error('OPENAI_API_KEY not configured');

  const conversation = [...messages];
  let lastToolOutputs = [];
  let lastUsage = null;
  // Track executed tool calls and their outputs to prevent loops,
  // but reuse results when the assistant requests the same call again.
  const executedToolCalls = new Map();

  for (let i = 0; i < maxIterations; i++) {
    const body = {
      model: model || _cfg.model,
      messages: conversation,
      temperature,
      stream: false,
      tool_choice: 'auto',
      tools
    };

    const res = await fetchWithRetries(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
      body: JSON.stringify(body)
    }, { retries: 2, timeoutMs: 30000 });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GPT] OpenAI error: ${res.status}`, text);
      throw new Error(`OpenAI chat error: ${res.status} ${text}`);
    }

    const payload = await res.json();
    if (payload.usage) {
      lastUsage = {
        promptTokens: payload.usage.prompt_tokens || 0,
        completionTokens: payload.usage.completion_tokens || 0,
        totalTokens: payload.usage.total_tokens || 0,
      };
    }
    const message = payload.choices?.[0]?.message;
    const toolCalls = message?.tool_calls || [];

    // Add assistant's message (which contains the tool calls) to the conversation
    conversation.push(message);

    // If assistant returned tool calls, execute each and append tool results
    if (toolCalls.length > 0) {
      console.log(`[GPT] Iteration ${i+1}: Assistant requested ${toolCalls.length} tool calls`);
      let newToolCallExecuted = false;

      for (const call of toolCalls) {
        const name = call.function?.name;
        const argsText = call.function?.arguments || '{}';
        
        // Create a unique key for this tool call
        const callKey = `${name}:${argsText}`;
        // If we've executed this exact call earlier in this run, reuse its output
        if (executedToolCalls.has(callKey)) {
          console.log(`[GPT] Reusing result for duplicate tool call: ${callKey}`);
          const prev = executedToolCalls.get(callKey);

          // Push a tool message with the previous output so the assistant can see it
          // Push a summarized tool output to the assistant to avoid large token usage
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: summarizeToolOutput(prev.output)
          });

          // Also include it in the returned toolOutputs so callers can build components
          lastToolOutputs.push({ name, args: prev.args, output: prev.output });
          newToolCallExecuted = true;
          continue;
        }

        newToolCallExecuted = true;

        let args = {};
        try { args = JSON.parse(argsText); } catch { args = {}; }

        console.log(`[GPT] Executing tool: ${name}`, args);
        const output = await executeTool(name, args, context);
        // Log a short summary of the tool output for debugging (avoid huge base64 dumps)
        try {
          if (output && typeof output === 'object') {
            if (output.error) {
              console.log(`[GPT] Tool ${name} returned error:`, output.error);
            } else if (output.url) {
              // Don't print full urls in production logs, but show presence
              console.log(`[GPT] Tool ${name} returned URL (length ${String(output.url).length})`);
            } else if (output.b64_json || output.b64) {
              const b64len = (output.b64_json || output.b64 || '').length;
              console.log(`[GPT] Tool ${name} returned base64 payload (length ${b64len})`);
            } else {
              console.log(`[GPT] Tool ${name} returned object keys:`, Object.keys(output));
            }
          } else {
            console.log(`[GPT] Tool ${name} returned:`, output);
          }
        } catch (e) {
          console.log('[GPT] Failed to log tool output summary', e.message);
        }

        // Keep track of outputs for caller and for reuse
        lastToolOutputs.push({ name, args, output });
        executedToolCalls.set(callKey, { name, args, output });

        // Push a summarized tool output to the assistant to avoid embedding huge data
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: summarizeToolOutput(output)
        });
      }
      
      if (!newToolCallExecuted) {
        // If no new tool calls were executed (all were duplicates), we should break to avoid infinite loop
        console.warn(`[GPT] No new tool calls executed in iteration ${i+1}. Breaking loop.`);
        break;
      }

      // Continue the loop to let the assistant respond to tool results
      continue;
    }

    // No tool calls; return assistant content
    const content = message?.content || '';
    if (i > 0) console.log(`[GPT] Completed after ${i+1} iterations.`);
    if (lastUsage && context) {
      recordUsage({ ...context, model: model || _cfg.model, promptTokens: lastUsage.promptTokens, completionTokens: lastUsage.completionTokens, totalTokens: lastUsage.totalTokens, endpoint: 'runChatWithTools' });
    }
    return { content, toolOutputs: lastToolOutputs };
  }

  // Fallback if we exceed iterations without final content
  console.warn(`[GPT] Exceeded maxIterations (${maxIterations}). Returning partial response.`);
  if (lastUsage && context) {
    recordUsage({ ...context, model: model || _cfg.model, promptTokens: lastUsage.promptTokens, completionTokens: lastUsage.completionTokens, totalTokens: lastUsage.totalTokens, endpoint: 'runChatWithTools' });
  }
  return { 
    content: 'I have processed your request using my available tools, but I hit a processing limit before I could provide a final summary. Here is what I found so far.', 
    toolOutputs: lastToolOutputs 
  };
}

/**
 * Tool definitions for OpenAI function calling.
 */
function defaultTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Searches the live web for current information, news, or facts using a search engine.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to look up' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetches web content from a safe allowed URL and returns a concise summary.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTPS URL to fetch' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generates an image for the given prompt and returns an accessible URL.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed image prompt' },
            size: { type: 'string', enum: ['512x512','1024x1024'], default: '512x512' }
          },
          required: ['prompt']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'generate_chart_spec',
        description: 'Creates a simple chart spec for client-side rendering (bar or line).',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['bar','line'] },
            title: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
            data: { type: 'array', items: { type: 'number' } }
          },
          required: ['type','labels','data']
        }
      }
    }
  ];
}

/**
 * Executes a requested tool.
 */
async function executeTool(name, args, context) {
  switch (name) {
    case 'web_search':
      return await safeWebSearch(args.query);
    case 'web_fetch':
      return await safeWebFetch(args.url);
    case 'generate_image':
      return await generateImage(args.prompt, args.size || '512x512', context);
    case 'generate_chart_spec':
      return normalizeChartSpec(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * Safe web search using Tavily API if configured, or fallback message.
 */
async function safeWebSearch(query) {
  const apiKey = (process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[GPT Tool] web_search called but TAVILY_API_KEY is not set.');
    return { 
      error: "Search service not configured. Please provide a TAVILY_API_KEY in the environment.",
      fallback: "Try using web_fetch if you have a specific URL, or rely on internal knowledge."
    };
  }

  console.log(`[GPT Tool] Initiating web_search for: "${query.slice(0, 50)}..."`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout for search

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: "basic",
        include_answer: true,
        max_results: 5
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const text = await response.text();
      console.error(`[GPT Tool] Tavily API error: ${response.status}`, text);
      return { error: `Search API error: ${response.status} ${text}` };
    }

    const data = await response.json();
    console.log(`[GPT Tool] web_search success for: "${query}"`);
    return {
      answer: data.answer,
      results: (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content
      }))
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[GPT Tool] web_search timed out');
      return { error: "Search service timed out. Please try again or use a different tool." };
    }
    console.error('[GPT Tool] web_search failed:', err);
    return { error: `Search execution failed: ${err.message}` };
  }
}

/**
 * Safe web fetch with allowlist, size and timeout limits.
 */
async function safeWebFetch(rawUrl) {
  const url = String(rawUrl || '').trim();
  const allowed = (process.env.BROWSING_ALLOWLIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!/^https?:\/\//i.test(url)) return { error: 'Only http(s) URLs allowed' };
  if (allowed.length > 0 && !allowed.some(domain => url.includes(domain))) {
    return { error: 'URL not in allowlist' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('json')) {
      return { error: 'Unsupported content type' };
    }
    const text = await res.text();
    const max = 100_000;
    const snippet = text.slice(0, max);
    const stripped = snippet.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
    return { title, excerpt: stripped.slice(0, 2000), url };
  } catch (e) {
    return { error: `Fetch error: ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate image using OpenAI's gpt-image-1, with SVG fallback via chat model.
 */
async function generateImage(prompt, size = '1024x1024', context) {
  // Normalize size for gpt-image-1 (only 1024x1024, 1024x1536, 1536x1024, auto)
  const normalizedSize = (() => {
    const s = String(size || '').trim() || '1024x1024';
    if (['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(s)) return s;
    return '1024x1024';
  })();

  // Try gpt-image-1 via the Images API
  try {
    const body = { model: 'gpt-image-1', prompt, size: normalizedSize };
    const res = await fetchWithRetries(IMAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
      body: JSON.stringify(body)
    }, { retries: 1, timeoutMs: 60000 });

    if (res.ok) {
      const payload = await res.json();
      const first = payload?.data?.[0] || {};
      const url = first.url || null;
      const b64 = first.b64_json || first.b64 || null;

      if (url) {
        console.log(`[GPT Tool] Image generated via gpt-image-1`);
        if (context) {
          recordUsage({ ...context, model: 'gpt-image-1', promptTokens: 0, completionTokens: 0, totalTokens: 0, endpoint: 'generateImage' });
        }
        return { url, size: normalizedSize, model: 'gpt-image-1' };
      }
      if (b64) {
        console.log(`[GPT Tool] Image generated via gpt-image-1 (base64)`);
        if (context) {
          recordUsage({ ...context, model: 'gpt-image-1', promptTokens: 0, completionTokens: 0, totalTokens: 0, endpoint: 'generateImage' });
        }
        return { url: `data:image/png;base64,${b64}`, size: normalizedSize, model: 'gpt-image-1' };
      }
    } else {
      const text = await res.text();
      console.warn(`[GPT Tool] gpt-image-1 error: ${res.status} ${text}. Falling back to SVG generation.`);
    }
  } catch (err) {
    console.warn(`[GPT Tool] gpt-image-1 request failed: ${err.message}. Falling back to SVG generation.`);
  }

  // Fallback: generate SVG via the chat model
  console.log(`[GPT Tool] Generating SVG illustration via chat model for: "${prompt.slice(0, 60)}..."`);
  try {
    const svgDataUri = await generateSVGIllustration(prompt, size, context);
    if (svgDataUri) {
      console.log(`[GPT Tool] Image generated via SVG chat model`);
      if (context) {
        recordUsage({ ...context, model: 'gpt-svg', promptTokens: 0, completionTokens: 0, totalTokens: 0, endpoint: 'generateSVGIllustration' });
      }
      return { url: svgDataUri, size: '800x600', model: 'gpt-svg', fallback: true };
    }
  } catch (err) {
    console.error(`[GPT Tool] SVG generation failed:`, err.message);
  }

  // Last resort: generic placeholder
  console.warn(`[GPT Tool] All image generation methods failed, returning placeholder`);
  let dim = 512;
  try {
    const parts = String(size || '').split('x');
    const p = parseInt(parts[0], 10);
    if (!isNaN(p) && p > 0 && p <= 2048) dim = p;
  } catch (e) {}

  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='${dim}' height='${dim}' viewBox='0 0 ${dim} ${dim}'><rect width='100%' height='100%' fill='#f3f4f6'/><g><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#374151' font-family='Arial, Helvetica, sans-serif' font-size='${Math.max(12, Math.round(dim/24))}'>Image unavailable</text></g></svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, size: `${dim}x${dim}`, model: null, fallback: true, error: 'All image generation methods failed' };
}

/**
 * Use the chat model to generate an SVG illustration from a text prompt.
 * This is a robust fallback when the DALL-E API is unavailable.
 */
async function generateSVGIllustration(prompt, size, context) {
  const systemMsg = `You generate clean SVG illustrations based on text descriptions.

Rules:
- Return ONLY the raw SVG code, no markdown fences, no explanations
- Use <svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"> as the root
- Use modern flat design with a professional color palette
- Include shapes (rect, circle, path), text labels, and icons
- Keep the composition clear and readable
- Use only standard SVG elements; no external images, fonts, or scripts`;

  const body = {
    model: _cfg.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000
  };

  const res = await fetchWithRetries(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify(body)
  }, { retries: 1, timeoutMs: 30000 });

  if (!res.ok) return null;

  const payload = await res.json();
  if (payload.usage && context) {
    recordUsage({ ...context, model: _cfg.model || 'gpt-4o-mini', promptTokens: payload.usage.prompt_tokens || 0, completionTokens: payload.usage.completion_tokens || 0, totalTokens: payload.usage.total_tokens || 0, endpoint: 'generateSVGIllustration' });
  }
  let svg = payload?.choices?.[0]?.message?.content || '';
  svg = svg.replace(/```svg\n?/gi, '').replace(/```\n?/g, '').trim();

  if (!svg.includes('<svg')) return null;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Normalize chart spec for client rendering.
 */
function normalizeChartSpec(args) {
  const type = ['bar','line'].includes(args.type) ? args.type : 'bar';
  const labels = Array.isArray(args.labels) ? args.labels : [];
  const data = Array.isArray(args.data) ? args.data : [];
  return {
    type,
    title: String(args.title || '').trim(),
    labels,
    data
  };
}

module.exports = {
  streamChatCompletion,
  evaluateAnswer,
  runChatWithTools,
  defaultTools
};
