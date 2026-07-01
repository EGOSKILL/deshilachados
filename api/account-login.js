// POST /api/account-login  { email, website(honeypot) }
// Si el email está en la lista, crea un token de acceso (24 h) y envía un enlace mágico con Resend.
// Responde siempre ok (no revela si el email existe).

const crypto = require('crypto');

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL } = process.env;
  let SITE_URL = process.env.SITE_URL || 'https://www.deshilachados.com';
  SITE_URL = SITE_URL.replace('://deshilachados.com', '://www.deshilachados.com'); // el apex no resuelve, forzamos www
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !FROM_EMAIL) {
    console.error('Faltan variables de entorno');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = (body?.email || '').trim().toLowerCase();
  if (body?.website) return res.status(200).json({ ok: true }); // honeypot
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'invalid_email' });

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // ¿está suscrito?
    const q = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=email`, { headers: sbHeaders });
    const rows = q.ok ? await q.json() : [];
    // Respondemos ok siempre; solo enviamos enlace si existe (evita revelar la lista)
    if (!Array.isArray(rows) || rows.length === 0) return res.status(200).json({ ok: true });

    const token = crypto.randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 h

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/access_tokens`, {
      method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify([{ token, email, expires_at: expires }]),
    });
    if (!ins.ok) { console.error('token insert error', ins.status, await ins.text()); return res.status(500).json({ ok: false, error: 'db_error' }); }

    const link = `${SITE_URL}/mi-cuenta?token=${token}`;
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: 'Tu acceso a Mi Cuenta · Deshilachados', html: loginEmail(link) }),
    });
    if (!mail.ok) { console.error('Resend error', mail.status, await mail.text()); return res.status(200).json({ ok: true, emailSent: false }); }

    return res.status(200).json({ ok: true, emailSent: true });
  } catch (err) {
    console.error('account-login error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};

function loginEmail(link) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#FAF6EE;font-family:Arial,Helvetica,sans-serif;color:#2B2622">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EE;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E3D6BD;border-radius:16px;overflow:hidden">
      <tr><td style="background:#2B2622;padding:24px 32px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#FAF6EE">DESHILA<span style="color:#D4881F">CHADOS</span></div>
        <div style="font-size:11px;letter-spacing:2px;color:#D4881F;margin-top:4px">SÁNDWICHES · MADRID</div>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 12px">Tu acceso a Mi Cuenta</h1>
        <p style="font-size:16px;line-height:1.6;color:#7A6A55;margin:0 0 24px">Pulsa el botón para ver tu código 2x1 y las promos activas. El enlace es válido durante 24 horas.</p>
        <a href="${link}" style="display:inline-block;background:#B03A2E;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:26px">Entrar a Mi Cuenta</a>
        <p style="font-size:13px;line-height:1.6;color:#7A6A55;margin:24px 0 0">Si no has pedido este enlace, puedes ignorar este correo.</p>
      </td></tr>
      <tr><td style="background:#EFE6D3;padding:16px 32px;text-align:center;font-size:12px;color:#7A6A55">@deshilachados.madrid · Madrid</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
