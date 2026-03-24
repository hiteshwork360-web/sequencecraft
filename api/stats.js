export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── In-memory counters (persists within same Edge instance) ──────────────────
// globalThis keeps state across requests on the same server instance
const state = globalThis.__scStats || (globalThis.__scStats = {
  totalCount:    0,        // all-time total sequences generated
  hourlyCount:   0,        // sequences generated this hour
  lastFlushHour: -1,       // hour index of last flush to sheets
  lastFlushedAt: null,     // ISO timestamp of last flush
});
globalThis.__scStats = state;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── GET /api/stats — return current count for UI display ─────────────────
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      total:       state.totalCount,
      lastFlushed: state.lastFlushedAt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── POST /api/stats — called after each successful sequence generation ────
  if (req.method === 'POST') {
    try {
      const body = await req.json().catch(() => ({}));
      const count = parseInt(body.count) || 1; // how many sequences in this batch call

      // Increment counters
      state.totalCount  += count;
      state.hourlyCount += count;

      const now      = new Date();
      const hourIdx  = Math.floor(now.getTime() / (1000 * 60 * 60)); // unique per hour

      // ── Flush to Google Sheets once per hour ──────────────────────────────
      if (hourIdx !== state.lastFlushHour) {
        state.lastFlushHour = hourIdx;
        const snapshot = {
          timestamp:    now.toISOString(),
          hour_label:   formatHour(now),
          hourly_count: state.hourlyCount,
          total_count:  state.totalCount,
        };
        state.hourlyCount  = 0; // reset hourly counter after flush
        state.lastFlushedAt = now.toISOString();

        // Fire-and-forget to Sheets — don't await so we don't slow down the response
        saveHourlyToSheets(snapshot).catch(e => console.error('Sheets flush error:', e));
      }

      return new Response(JSON.stringify({
        ok:    true,
        total: state.totalCount,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function saveHourlyToSheets(data) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ _type: 'stats', ...data }),
  });
}

function formatHour(date) {
  return date.toLocaleString('en-US', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
