export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  // ── GET /api/stats — return current total for nav counter ────────────────
  if (req.method === 'GET') {
    try {
      const total = await getTotal();
      return new Response(JSON.stringify({ total }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (e) {
      return new Response(JSON.stringify({ total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // ── POST /api/stats — increment counter after each successful generation ──
  if (req.method === 'POST') {
    try {
      const body  = await req.json().catch(() => ({}));
      const count = parseInt(body.count) || 1;

      const newTotal = await incrementTotal(count);

      // Also flush hourly row to Google Sheets (fire and forget)
      logHourlyToSheets(newTotal, count).catch(() => {});

      return new Response(JSON.stringify({ ok: true, total: newTotal }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (e) {
      console.error('stats POST error:', e);
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// ── Read current total from Supabase ─────────────────────────────────────────
async function getTotal() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sequence_stats?id=eq.1&select=total_count`,
    {
      headers: {
        'apikey':         SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );
  const rows = await res.json();
  return rows?.[0]?.total_count || 0;
}

// ── Atomically increment total in Supabase using RPC ─────────────────────────
async function incrementTotal(by) {
  // Use Supabase RPC to do an atomic increment (prevents race conditions)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_sequence_count`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':         SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ increment_by: by })
  });

  // If RPC not available, fall back to read-then-write
  if (!res.ok) {
    const current = await getTotal();
    const newTotal = current + by;
    await fetch(`${SUPABASE_URL}/rest/v1/sequence_stats?id=eq.1`, {
      method:  'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer':         'return=representation',
      },
      body: JSON.stringify({ total_count: newTotal, updated_at: new Date().toISOString() })
    });
    return newTotal;
  }

  const data = await res.json();
  return data?.total_count || (await getTotal());
}

// ── Log hourly snapshot to Google Sheets ─────────────────────────────────────
async function logHourlyToSheets(total, added) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;
  if (!webhookUrl) return;

  const now = new Date();
  // Only log once per hour — use hourly timestamp as dedup key
  const hourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
  const lastHour = globalThis.__lastStatsHour;
  if (lastHour === hourKey) return; // already logged this hour
  globalThis.__lastStatsHour = hourKey;

  await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      _type:        'stats',
      timestamp:     now.toISOString(),
      hour_label:    now.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }),
      hourly_count:  added,
      total_count:   total,
    })
  });
}
