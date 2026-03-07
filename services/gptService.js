const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const { prisma } = require('../utils/prismaClient');

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

async function streamChatCompletion({ model = 'gpt-4o-mini', messages = [], temperature = 0.7, onChunk, onDone, onError }) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) {
    const err = new Error('OPENAI_API_KEY not configured');
    if (onError) onError(err);
    throw err;
  }

  const body = { model: model || _cfg.model, messages, temperature, stream: true };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_cfg.apiKey}`
    },
    body: JSON.stringify(body)
  });

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
        if (data === '[DONE]') {
          if (onDone) onDone();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta && onChunk) onChunk(delta);
        } catch (e) {}
      }
    }
  }

  if (onDone) onDone();
}

async function evaluateAnswer({ model = 'gpt-4o-mini', messages = [], temperature = 0.0, max_tokens = 300 }) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) throw new Error('OPENAI_API_KEY not configured');

  const body = { model: model || _cfg.model, messages, temperature, max_tokens, stream: false };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI eval error: ${res.status} ${text}`);
  }

  const payload = await res.json();
  const assistant = payload.choices?.[0]?.message?.content || '';

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
  maxIterations = 8
}) {
  await loadConfigIfStale();
  if (!_cfg.apiKey) throw new Error('OPENAI_API_KEY not configured');

  const conversation = [...messages];
  let lastToolOutputs = [];
  const executedToolCalls = new Set(); // Track executed tool calls to prevent loops

  for (let i = 0; i < maxIterations; i++) {
    const body = {
      model: model || _cfg.model,
      messages: conversation,
      temperature,
      stream: false,
      tool_choice: 'auto',
      tools
    };

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GPT] OpenAI error: ${res.status}`, text);
      throw new Error(`OpenAI chat error: ${res.status} ${text}`);
    }

    const payload = await res.json();
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
        
        // Create a unique key for this tool call to prevent duplicates
        const callKey = `${name}:${argsText}`;
        if (executedToolCalls.has(callKey)) {
          console.warn(`[GPT] Skipping duplicate tool call: ${callKey}`);
          
          // Still need to provide a response for the tool call in the conversation
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: "Error: This tool was already called with these exact parameters in this turn. Please provide final response or use different parameters."
          });
          continue;
        }
        
        executedToolCalls.add(callKey);
        newToolCallExecuted = true;

        let args = {};
        try { args = JSON.parse(argsText); } catch { args = {}; }

        console.log(`[GPT] Executing tool: ${name}`, args);
        const output = await executeTool(name, args);

        // Keep track of outputs for caller
        lastToolOutputs.push({ name, args, output });

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof output === 'string' ? output : JSON.stringify(output)
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
    return { content, toolOutputs: lastToolOutputs };
  }

  // Fallback if we exceed iterations without final content
  console.warn(`[GPT] Exceeded maxIterations (${maxIterations}). Returning partial response.`);
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
async function executeTool(name, args) {
  switch (name) {
    case 'web_search':
      return await safeWebSearch(args.query);
    case 'web_fetch':
      return await safeWebFetch(args.url);
    case 'generate_image':
      return await generateImage(args.prompt, args.size || '512x512');
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
 * Generate image via OpenAI Images API.
 */
async function generateImage(prompt, size = '1024x1024') {
  const body = { model: 'dall-e-3', prompt, size };
  const res = await fetch(IMAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `Image API error: ${res.status} ${text}` };
  }
  const payload = await res.json();
  const url = payload?.data?.[0]?.url || null;
  return url ? { url, size } : { error: 'No image URL returned' };
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
