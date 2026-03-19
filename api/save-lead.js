export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
    const body = await req.json();
    const { name, email, phone, timestamp, source } = body;

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ── Google Sheets via Apps Script Web App URL ────────────────────────────
    // This calls a Google Apps Script deployed as a Web App that appends a row.
    // Set GOOGLE_SHEET_WEBHOOK in Vercel env vars to your Apps Script URL.
    const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;

    if (!webhookUrl) {
      console.warn('GOOGLE_SHEET_WEBHOOK env var not set — lead not saved to sheets');
      return new Response(JSON.stringify({ ok: true, note: 'Webhook not configured' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const sheetsRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, timestamp, source }),
    });

    if (!sheetsRes.ok) {
      const text = await sheetsRes.text();
      console.error('Sheets webhook error:', sheetsRes.status, text);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    console.error('save-lead error:', err);
    return new Response(JSON.stringify({ ok: true }), { // still 200 so UX doesn't break
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
