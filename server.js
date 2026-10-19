const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config();
} catch {
  /* dotenv is optional */
}

const { TOOLS, runTool } = require('./tools');

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '0.0.0.0';
const PUB = path.join(__dirname, 'public');
const LLM_BASE_URL = (
  process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1'
).replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'openai/gpt-oss-120b';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 15) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the OPEX assistant for Vertex Demo Manufacturing, a fictional
demonstration company. All data is synthetic. Department: Operational Excellence.
Today is ${today}.

Tools cover production, plan variance, 5S audits, QCP audits, Kaizen and breakdowns.
Plants are Plant A, Plant B and Plant C.

Rules:
1. Call a tool before stating any number. Never invent data.
2. If plant or period is missing, default to all plants and the last 6 months.
3. State the plant and date range used.
4. If a tool returns no rows, say so. Do not extrapolate.
5. Keep answers to 2-5 sentences, then a compact table only if needed.
6. Do not mention SQL, table names, internal tool names, or real companies.
7. The dashboard above the chat already shows charts. If asked for a chart,
   describe what the dashboard shows and explain the trend.

When asked how to improve, diagnose first:
- 5S: get_5s_summary by zone or plant.
- QCP: get_qcp_summary by test.
- Production: get_production_summary and get_plan_variance.
  For period totals or plant comparisons use get_production_summary by="plant";
  use get_plan_variance only for monthly detail.
- Downtime: get_breakdown_summary by machine or cause.
Then search_kaizen for similar past improvements and get_advice for best practice.
Answer with: current numbers, the specific weak point, three prioritised actions
with owner and timeframe, and any similar Kaizen. Label recommendations as
"based on your data" or "general best practice". Never promise that an action
will improve performance. Use at most six tool calls, then answer.`;
}

async function callLLM(messages, toolChoice = 'auto') {
  let lastError = 'LLM request failed';

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LLM_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOLS,
          tool_choice: toolChoice,
          temperature: 0.1,
          max_tokens: 800
        }),
        signal: controller.signal
      });

      if (response.status === 429) {
        const text = await response.text();
        const match = /try again in ([\d.]+)s/i.exec(text);
        const wait = Math.min(
          20,
          Math.max(3, match ? Math.ceil(Number(match[1])) + 2 : 8)
        );
        console.warn(`[chat] rate limited, retrying in ${wait}s`);
        lastError = text.slice(0, 300);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM ${response.status}: ${text.slice(0, 300)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`LLM rate limit: ${lastError}`);
}

function toTable(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') return null;
  const columns = Object.keys(rows[0]).slice(0, 12);
  const data = rows.slice(0, 30).map((row) => columns.map((col) => row[col]));
  return { columns, rows: data, total: rows.length };
}

async function handleChat(req, res) {
  if (!LLM_API_KEY) {
    return sendJson(res, 503, {
      error: 'No LLM key configured. Set LLM_API_KEY in .env.'
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const history = incoming
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim()
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!history.length) return sendJson(res, 400, { error: 'messages is required' });

  const messages = [{ role: 'system', content: systemPrompt() }, ...history];
  const used = [];
  let lastRows = null;

  try {
    for (let step = 0; step < 8; step++) {
      const completion = await callLLM(
        messages,
        used.length >= 6 ? 'none' : 'auto'
      );
      const message = completion.choices?.[0]?.message;
      if (!message) throw new Error('Empty response from LLM');
      messages.push(message);

      if (!message.tool_calls || !message.tool_calls.length) {
        const result = {
          answer: message.content || 'No answer produced.',
          tools: used,
          model: MODEL
        };
        const table = toTable(lastRows);
        if (table) result.table = table;
        return sendJson(res, 200, result);
      }

      for (const call of message.tool_calls) {
        let output;
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          output = await runTool(call.function.name, args);
          used.push({ tool: call.function.name, args });
          if (Array.isArray(output) && output.length) lastRows = output;
        } catch (err) {
          output = { error: String(err.message || err) };
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output).slice(0, 12000)
        });
      }
    }

    return sendJson(res, 200, {
      answer: 'I could not finish that query. Try asking with a plant and date range.',
      tools: used,
      model: MODEL
    });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return sendJson(res, 502, { error: err.message || 'Chat request failed' });
  }
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return sendJson(res, 429, { error: 'Too many requests. Wait a minute.' });
    }
    return handleChat(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method not allowed');
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Vertex Demo OPEX dashboard: http://localhost:${PORT}`);
});
