export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
];

const MAX_TOKENS_ALLOWED = 7000;
const MAX_BODY_CHARS     = 30000;

const ipStore = globalThis.__ipStore || (globalThis.__ipStore = new Map());
globalThis.__ipStore = ipStore;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQS  = 60;

function checkRateLimit(ip) {
  const now    = Date.now();
  const record = ipStore.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    record.count = 0; record.windowStart = now;
  }
  record.count++;
  ipStore.set(ip, record);
  if (record.count > RATE_LIMIT_MAX_REQS) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return `Rate limit exceeded. Try again in ${resetIn} seconds.`;
  }
  return null;
}

function gatekeeper(body) {
  // 1. Model check — allow any Claude model
  const model = body.model || '';
  if (model && !model.startsWith('claude')) {
    return `Rejected: only Claude models are permitted.`;
  }

  // 2. Max tokens cap
  if (body.max_tokens && body.max_tokens > MAX_TOKENS_ALLOWED) {
    return `Rejected: max_tokens ${body.max_tokens} exceeds limit of ${MAX_TOKENS_ALLOWED}.`;
  }

  // 3. Payload size
  const systemText  = body.system || '';
  const messageText = (body.messages || []).map(m =>
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  ).join(' ');
  if (systemText.length + messageText.length > MAX_BODY_CHARS) {
    return `Rejected: payload too large.`;
  }

  // 4. System prompt fingerprint
  const systemLower = systemText.toLowerCase();
  for (const phrase of REQUIRED_SYSTEM_PHRASES) {
    if (!systemLower.includes(phrase.toLowerCase())) {
      return `Rejected: missing required phrase "${phrase}".`;
    }
  }

  // 5. User message fingerprint
  const messageLower = messageText.toLowerCase();
  for (const phrase of REQUIRED_USER_PHRASES) {
    if (!messageLower.includes(phrase.toLowerCase())) {
      return `Rejected: missing required phrase "${phrase}".`;
    }
  }

  // 6. Block prompt injection
  const fullText = (systemText + ' ' + messageText).toLowerCase();
  for (const phrase of BLOCKED_PHRASES) {
    if (fullText.includes(phrase.toLowerCase())) {
      return `Rejected: blocked phrase detected.`;
    }
  }

  // 7. Message structure
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Rejected: messages must be a non-empty array.';
  }
  if (body.messages.length > 3) {
    return `Rejected: too many messages.`;
  }
  if (body.messages[0].role !== 'user') {
    return `Rejected: first message role must be "user".`;
  }

  return null;
}

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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimitError = checkRateLimit(ip);
    if (rateLimitError) {
      return new Response(JSON.stringify({ error: rateLimitError }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const body = await req.json();
    if (!body.system || !body.messages) {
      return new Response(JSON.stringify({ error: 'Missing required fields.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const gateError = gatekeeper(body);
    if (gateError) {
      console.warn(`[GATEKEEPER] ${gateError}`);
      return new Response(JSON.stringify({ error: gateError }), {
        status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':          process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      body.model || 'claude-sonnet-4-20250514',
        max_tokens: Math.min(body.max_tokens || 7000, MAX_TOKENS_ALLOWED),
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
