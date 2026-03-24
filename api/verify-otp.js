export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Shared OTP store — same Edge instance as send-otp.js
// Uses a global Map so OTPs persist across requests within the same instance
const otpStore = globalThis.__otpStore || (globalThis.__otpStore = new Map());

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

    const cleanPhone = phone.trim().replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    const record = globalThis.__otpStore?.get(formattedPhone);

    // No OTP found for this number
    if (!record) {
      return new Response(JSON.stringify({ ok: false, error: 'No OTP found. Please request a new code.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Check expiry
    if (Date.now() > record.expires) {
      globalThis.__otpStore.delete(formattedPhone);
      return new Response(JSON.stringify({ ok: false, error: 'Code expired. Please request a new one.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Rate limit — max 5 attempts per OTP
    if (record.attempts >= 5) {
      globalThis.__otpStore.delete(formattedPhone);
      return new Response(JSON.stringify({ ok: false, error: 'Too many attempts. Please request a new code.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Wrong code
    if (otp.trim() !== record.otp) {
      record.attempts++;
      return new Response(JSON.stringify({
        ok: false,
        error: `Incorrect code. ${5 - record.attempts} attempt${5 - record.attempts !== 1 ? 's' : ''} remaining.`
      }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // ✅ Correct — delete OTP so it can't be reused
    globalThis.__otpStore.delete(formattedPhone);

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
