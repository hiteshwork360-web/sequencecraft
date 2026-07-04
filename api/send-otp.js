export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });

  try {
    const body = await req.json();
    const phone = (body.phone || '').trim().replace(/\s+/g, '');

    if (!phone || phone.length < 7) {
      return new Response(JSON.stringify({ error: 'Invalid phone number. Include country code e.g. +91 98765 43210' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const formattedPhone = phone.startsWith('+') ? phone : '+' + phone;

    // ── Validate env vars exist before calling Twilio ─────────────────────────
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone  = process.env.TWILIO_PHONE_NUMBER;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!accountSid) return new Response(JSON.stringify({ error: 'SMS service not configured (SID missing). Contact support.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
    if (!authToken) return new Response(JSON.stringify({ error: 'SMS service not configured (token missing). Contact support.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
    if (!fromPhone) return new Response(JSON.stringify({ error: 'SMS service not configured (number missing). Contact support.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
    if (!supabaseUrl || !supabaseKey) return new Response(JSON.stringify({ error: 'Database not configured. Contact support.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

    // ── Generate OTP ──────────────────────────────────────────────────────────
    const otp       = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // ── Save OTP to Supabase ──────────────────────────────────────────────────
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/otp_store`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer':         'resolution=merge-duplicates',
      },
      body: JSON.stringify({ phone: formattedPhone, otp, expires_at: expiresAt, attempts: 0 }),
    });

    if (!dbRes.ok) {
      const dbErr = await dbRes.text();
      console.error('Supabase error:', dbErr);
      return new Response(JSON.stringify({ error: 'Failed to prepare verification. Please try again.' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // ── Send SMS via Twilio ───────────────────────────────────────────────────
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams({
          To:   formattedPhone,
          From: fromPhone,
          Body: `Your SequenceCraft code: ${otp}\n\nValid 10 mins. Do not share.`,
        }),
      }
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error('Twilio error:', JSON.stringify(twilioData));
      // Return the actual Twilio error message so user knows what happened
      const msg = twilioData.message || twilioData.error_message || 'Failed to send SMS.';
      return new Response(JSON.stringify({
        error: `SMS failed: ${msg} — Make sure your number includes country code e.g. +91 98765 43210`
      }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('send-otp unhandled error:', err.message, err.stack);
    return new Response(JSON.stringify({ error: `Server error: ${err.message}` }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
