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
    const { phone } = await req.json();

    if (!phone || phone.trim().length < 7) {
      return new Response(JSON.stringify({ error: 'Invalid phone number' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const cleanPhone     = phone.trim().replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;
    const otp            = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt      = Date.now() + 10 * 60 * 1000;

    // Save OTP to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/otp_store`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer':         'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        phone:      formattedPhone,
        otp:        otp,
        expires_at: expiresAt,
        attempts:   0,
      }),
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      console.error('Supabase error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to store OTP. Please try again.' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Send SMS via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone  = process.env.TWILIO_PHONE_NUMBER;

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
          Body: `Your SequenceCraft verification code is: ${otp}\n\nValid for 10 minutes. Do not share this code.`,
        }),
      }
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error('Twilio error:', twilioData);
      return new Response(JSON.stringify({ error: twilioData.message || 'Failed to send SMS. Make sure phone includes country code e.g. +91 98765 43210' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({ ok: true, message: 'OTP sent successfully' }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('send-otp error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
