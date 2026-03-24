export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── GATEKEEPER ────────────────────────────────────────────────────────────────
// These signatures MUST be present in every legitimate request from SequenceCraft.
// A stolen key used from outside the app will never produce all of these together.

const REQUIRED_SYSTEM_PHRASES = [
  'cold email',
  'ghostwriter',
  'SELLER',
  'PROSPECT',
  'reply OR book a demo',
];

const REQUIRED_USER_PHRASES = [
  'SELLER:',
  'PROSPECT:',
  'REAL SIGNALS',
];

const BLOCKED_PHRASES = [
  'ignore previous',
  'ignore all previous',
  'forget your instructions',
  'you are now',
  'act as',
  'jailbreak',
  'dan mode',
  'developer mode',
  'pretend you are',
  'disregard',
  'bypass security',
  'bypass restrictions',
  'override your instructions',
  'new persona',
  'ignore safety',
  'roleplay as',
];

const ALLOWED_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-5-20251001',
  'claude-haiku-4-5-20251001',
];

const MAX_TOKENS_ALLOWED = 7000; // raised to match real output size (~5,600 tokens avg)
const MAX_BODY_CHARS     = 20000; // reject suspiciously large payloads

function gatekeeper(body) {
  // ── 1. Model whitelist ────────────────────────────────────────────────────
  const model = body.model || '';
  if (model && !ALLOWED_MODELS.includes(model)) {
    return `Rejected: model "${model}" is not permitted.`;
  }

  // ── 2. Max tokens cap ─────────────────────────────────────────────────────
  if (body.max_tokens && body.max_tokens > MAX_TOKENS_ALLOWED) {
    return `Rejected: max_tokens ${body.max_tokens} exceeds limit of ${MAX_TOKENS_ALLOWED}.`;
  }

  // ── 3. Payload size limit ─────────────────────────────────────────────────
  const systemText  = body.system || '';
  const messageText = (body.messages || []).map(m =>
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  ).join(' ');
  const totalChars = systemText.length + messageText.length;

  if (totalChars > MAX_BODY_CHARS) {
    return `Rejected: payload too large (${totalChars} chars, max ${MAX_BODY_CHARS}).`;
  }

  // ── 4. System prompt must contain required SequenceCraft phrases ──────────
  const systemLower = systemText.toLowerCase();
  for (const phrase of REQUIRED_SYSTEM_PHRASES) {
    if (!systemLower.includes(phrase.toLowerCase())) {
      return `Rejected: system prompt missing required phrase "${phrase}". Not a valid SequenceCraft request.`;
    }
  }

  // ── 5. User message must contain required phrases ─────────────────────────
  const messageLower = messageText.toLowerCase();
  for (const phrase of REQUIRED_USER_PHRASES) {
    if (!messageLower.includes(phrase.toLowerCase())) {
      return `Rejected: message missing required phrase "${phrase}". Not a valid SequenceCraft request.`;
    }
  }

  // ── 6. Block prompt injection attempts ───────────────────────────────────
  const fullText = (systemText + ' ' + messageText).toLowerCase();
  for (const phrase of BLOCKED_PHRASES) {
    if (fullText.includes(phrase.toLowerCase())) {
      return `Rejected: blocked phrase detected "${phrase}". Request denied.`;
    }
  }

  // ── 7. Messages must follow expected structure ────────────────────────────
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Rejected: messages must be a non-empty array.';
  }
  if (body.messages.length > 3) {
    return `Rejected: too many messages (${body.messages.length}). SequenceCraft sends 1.`;
  }
  const firstMsg = body.messages[0];
  if (firstMsg.role !== 'user') {
    return `Rejected: first message role must be "user", got "${firstMsg.role}".`;
  }

  return null; // ✅ all checks passed
}

// ── RATE LIMITER (simple in-memory per IP) ────────────────────────────────────
const ipStore = globalThis.__ipStore || (globalThis.__ipStore = new Map());
globalThis.__ipStore = ipStore;

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQS  = 60;        // max 60 requests per IP per minute (supports 30-row batches)

function checkRateLimit(ip) {
  const now    = Date.now();
  const record = ipStore.get(ip) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record.count       = 0;
    record.windowStart = now;
  }

  record.count++;
  ipStore.set(ip, record);

  if (record.count > RATE_LIMIT_MAX_REQS) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return `Rate limit exceeded. Try again in ${resetIn} seconds.`;
  }
  return null;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // ── Rate limit check ────────────────────────────────────────────────────
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || req.headers.get('x-real-ip')
            || 'unknown';

    const rateLimitError = checkRateLimit(ip);
    if (rateLimitError) {
      console.warn(`[RATE LIMIT] IP ${ip}: ${rateLimitError}`);
      return new Response(JSON.stringify({ error: rateLimitError }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json();

    if (!body.system || !body.messages) {
      return new Response(JSON.stringify({ error: 'Missing required fields: system, messages' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Gatekeeper check ────────────────────────────────────────────────────
    const gateError = gatekeeper(body);
    if (gateError) {
      console.warn(`[GATEKEEPER BLOCKED] IP ${ip}: ${gateError}`);
      return new Response(JSON.stringify({ error: gateError }), {
        status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Forward to Anthropic ────────────────────────────────────────────────
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':        process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0],
        max_tokens: Math.min(body.max_tokens || 2000, MAX_TOKENS_ALLOWED),
        system:     body.system,
        messages:   body.messages,
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'Anthropic API error' }), {
        status: anthropicRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    console.error('[generate.js error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
