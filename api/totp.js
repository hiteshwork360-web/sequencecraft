export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Pure Edge-compatible TOTP implementation (no npm needed) ──────────────────
// RFC 6238 compliant — works with Google Authenticator, Authy, Microsoft Authenticator

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const output = [];
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; output.push((value >> bits) & 0xff); }
  }
  return new Uint8Array(output);
}

function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; output += BASE32_CHARS[(value >> bits) & 31]; }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

function intToBytes(num) {
  const arr = new Uint8Array(8);
  let tmp = num;
  for (let i = 7; i >= 0; i--) {
    arr[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  return arr;
}

async function generateTOTP(secret, window = 0) {
  const key     = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + window;
  const msg     = intToBytes(counter);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  const hmac   = new Uint8Array(sig);
  const offset = hmac[19] & 0xf;
  const code   = ((hmac[offset] & 0x7f) << 24)
               | ((hmac[offset+1] & 0xff) << 16)
               | ((hmac[offset+2] & 0xff) << 8)
               |  (hmac[offset+3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

async function verifyTOTP(secret, token) {
  // Check current window and ±1 window for clock drift
  for (const w of [-1, 0, 1]) {
    const expected = await generateTOTP(secret, w);
    if (expected === token.trim()) return true;
  }
  return false;
}

function generateSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function buildOtpauthUrl(secret, email, issuer = 'SequenceCraft') {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function saveSecret(email, secret) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/totp_secrets`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         key,
      'Authorization': `Bearer ${key}`,
      'Prefer':         'resolution=merge-duplicates',
    },
    body: JSON.stringify({ email, secret, verified: false, created_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error('Failed to save TOTP secret: ' + await res.text());
}

async function getSecret(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${url}/rest/v1/totp_secrets?email=eq.${encodeURIComponent(email)}&select=secret,verified`,
    { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function markVerified(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  await fetch(`${url}/rest/v1/totp_secrets?email=eq.${encodeURIComponent(email)}`, {
    method:  'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ verified: true }),
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });

  try {
    const { action, email, token } = await req.json();

    // ── SETUP: generate secret + QR code URL ─────────────────────────────────
    if (action === 'setup') {
      if (!email) return new Response(JSON.stringify({ error: 'Email required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

      // Check if already has a verified secret
      const existing = await getSecret(email);
      if (existing?.verified) {
        return new Response(JSON.stringify({ ok: true, already_verified: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Generate new secret
      const secret    = generateSecret();
      const otpauth   = buildOtpauthUrl(secret, email);
      const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`;

      await saveSecret(email, secret);

      return new Response(JSON.stringify({
        ok:     true,
        qr_url: qrUrl,
        secret, // shown as manual entry fallback
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // ── VERIFY: check token from authenticator app ────────────────────────────
    if (action === 'verify') {
      if (!email || !token) return new Response(JSON.stringify({ error: 'Email and token required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

      const record = await getSecret(email);
      if (!record) return new Response(JSON.stringify({ error: 'No authenticator setup found. Please set up again.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

      const valid = await verifyTOTP(record.secret, token);
      if (!valid) return new Response(JSON.stringify({ ok: false, error: 'Incorrect code. Make sure your phone time is accurate and try again.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

      await markVerified(email);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('totp error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
