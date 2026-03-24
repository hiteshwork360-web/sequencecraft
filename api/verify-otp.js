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
    const { phone, otp } = await req.json();

    if (!phone || !otp) {
      return new Response(JSON.stringify({ error: 'Missing phone or otp' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const cleanPhone     = phone.trim().replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    // Fetch the OTP record from Supabase
    const fetchRes = await fetch(
      `${supabaseUrl}/rest/v1/otp_store?phone=eq.${encodeURIComponent(formattedPhone)}&select=*`,
      {
        headers: {
          'apikey':         supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    const rows = await fetchRes.json();

    // No record found
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No OTP found. Please request a new code.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const record = rows[0];

    // Check expiry
    if (Date.now() > record.expires_at) {
      // Delete expired record
      await deleteOtp(supabaseUrl, supabaseKey, formattedPhone);
      return new Response(JSON.stringify({ ok: false, error: 'Code expired. Please request a new one.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Too many attempts
    if (record.attempts >= 5) {
      await deleteOtp(supabaseUrl, supabaseKey, formattedPhone);
      return new Response(JSON.stringify({ ok: false, error: 'Too many attempts. Please request a new code.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Wrong code — increment attempts
    if (otp.trim() !== record.otp) {
      await fetch(`${supabaseUrl}/rest/v1/otp_store?phone=eq.${encodeURIComponent(formattedPhone)}`, {
        method:  'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':         supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ attempts: record.attempts + 1 }),
      });

      const remaining = 5 - (record.attempts + 1);
      return new Response(JSON.stringify({
        ok:    false,
        error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Correct — delete OTP so it cannot be reused
    await deleteOtp(supabaseUrl, supabaseKey, formattedPhone);

    return new Response(JSON.stringify({ ok: true, message: 'Phone verified successfully' }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('verify-otp error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function deleteOtp(supabaseUrl, supabaseKey, phone) {
  await fetch(`${supabaseUrl}/rest/v1/otp_store?phone=eq.${encodeURIComponent(phone)}`, {
    method:  'DELETE',
    headers: {
      'apikey':         supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
  });
}
