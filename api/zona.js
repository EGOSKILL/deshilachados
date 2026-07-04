// POST /api/zona  { email, cp, zona?, ref?, consent, website(honeypot) }
// "Vota tu barrio" con DOBLE OPT-IN: guarda el voto como confirmed=false + confirm_token
// y envía un email de confirmación con Resend. El voto NO cuenta como demanda hasta confirmarse.
// Reutiliza las mismas variables de entorno que /api/subscribe:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL, (opcional) SITE_URL
const crypto = require('crypto');

// CP -> distrito (Madrid capital, asignación PRIMARIA y editable; afinar sobre el terreno)
const CP2D = {
  '28001':'Salamanca','28002':'Chamartín','28003':'Chamberí','28004':'Centro','28005':'Centro',
  '28006':'Salamanca','28007':'Retiro','28008':'Moncloa-Aravaca','28009':'Retiro','28010':'Chamberí',
  '28011':'Latina','28012':'Centro','28013':'Centro','28014':'Centro','28015':'Chamberí',
  '28016':'Chamartín','28017':'Ciudad Lineal','28018':'Puente de Vallecas','28019':'Carabanchel','28020':'Tetuán',
  '28021':'Villaverde','28022':'San Blas-Canillejas','28023':'Moncloa-Aravaca','28024':'Latina','28025':'Carabanchel',
  '28026':'Usera','28027':'Ciudad Lineal','28028':'Salamanca','28029':'Tetuán','28030':'Moratalaz',
  '28031':'Villa de Vallecas','28032':'Vicálvaro','28033':'Hortaleza','28034':'Fuencarral-El Pardo','28035':'Fuencarral-El Pardo',
  '28036':'Chamartín','28037':'San Blas-Canillejas','28038':'Puente de Vallecas','28039':'Tetuán','28040':'Moncloa-Aravaca',
  '28041':'Villaverde','28042':'Barajas','28043':'Hortaleza','28044':'Latina','28045':'Arganzuela',
  '28046':'Chamartín','28047':'Carabanchel','28048':'Fuencarral-El Pardo','28049':'Fuencarral-El Pardo','28050':'Hortaleza',
  '28051':'Villa de Vallecas','28052':'Villa de Vallecas','28053':'Puente de Vallecas','28054':'Villaverde','28055':'Hortaleza'
};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(prefix, n) {
  let s = ''; const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return prefix + s;
}
function isValidEmail(e){ return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254; }
function isMadridCP(cp){ return /^280(0[1-9]|[1-4]\d|5[0-5])$/.test(cp); } // 28001–28055

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok:false, error:'method_not_allowed' }); }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL } = process.env;
  let SITE_URL = (process.env.SITE_URL || 'https://www.deshilachados.com').trim();
  if (!/^https?:\/\//i.test(SITE_URL)) SITE_URL = 'https://' + SITE_URL;
  SITE_URL = SITE_URL.replace(/\/+$/, '').replace('://deshilachados.com', '://www.deshilachados.com');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !FROM_EMAIL) {
    console.error('Faltan variables de entorno'); return res.status(500).json({ ok:false, error:'server_misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body?.website) return res.status(200).json({ ok:true }); // honeypot

  const email = (body?.email || '').trim().toLowerCase();
  const cp = (body?.cp || '').trim();
  const zona = (body?.zona || '').toString().slice(0, 80).trim();
  let ref = (body?.ref || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(ref)) ref = '';
  const consent = body?.consent === true || body?.consent === 'true';

  if (!isValidEmail(email)) return res.status(400).json({ ok:false, error:'invalid_email' });
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ ok:false, error:'invalid_cp' });
  if (!isMadridCP(cp)) return res.status(400).json({ ok:false, error:'not_madrid' });
  if (!consent) return res.status(400).json({ ok:false, error:'consent_required' });

  const distrito = CP2D[cp] || 'Sin asignar';
  const promo_code = genCode('ZV-', 6);
  const confirm_token = crypto.randomBytes(24).toString('base64url');

  const H = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // upsert por (email, cp): si ya existía sin confirmar, refrescamos token para poder reenviar
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/zonas_interes?on_conflict=email,codigo_postal`, {
      method: 'POST',
      headers: { ...H, 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify([{
        email, codigo_postal: cp, zona_texto: zona || null, distrito,
        promo_code, referred_by: ref || null,
        consent, consent_at: new Date().toISOString(),
        confirm_token, confirmed: false, source: 'zona'
      }]),
    });
    if (!ins.ok) { const t = await ins.text(); console.error('Supabase insert error', ins.status, t); return res.status(500).json({ ok:false, error:'db_error' }); }
    const rows = await ins.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;

    // si ya estaba confirmado, no reenviamos correo: respondemos "ya estabas"
    if (row && row.confirmed) return res.status(200).json({ ok:true, already:true });

    const token = (row && row.confirm_token) || confirm_token;
    const confirmUrl = `${SITE_URL}/api/zona-confirm?t=${encodeURIComponent(token)}`;

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: 'Confirma tu voto · Deshilachados en tu barrio',
        html: confirmEmail(cp, distrito, confirmUrl, SITE_URL),
      }),
    });
    if (!mail.ok) { const t = await mail.text(); console.error('Resend error', mail.status, t); return res.status(200).json({ ok:true, pending:true, emailSent:false }); }

    return res.status(200).json({ ok:true, pending:true, emailSent:true });
  } catch (err) {
    console.error('zona error', err);
    return res.status(500).json({ ok:false, error:'unexpected' });
  }
};

function confirmEmail(cp, distrito, url, site) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#FAF6EE;font-family:Arial,Helvetica,sans-serif;color:#2B2622">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EE;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E3D6BD;border-radius:16px;overflow:hidden">
      <tr><td style="background:#2B2622;padding:24px 32px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#FAF6EE;letter-spacing:.5px">DESHILA<span style="color:#D4881F">CHADOS</span></div>
        <div style="font-size:11px;letter-spacing:2px;color:#D4881F;margin-top:4px">SÁNDWICHES · MADRID</div>
      </td></tr>
      <tr><td style="padding:30px 32px 6px">
        <h1 style="font-family:Georgia,serif;font-size:24px;color:#2B2622;margin:0 0 12px">Un clic y tu voto cuenta</h1>
        <p style="font-size:16px;line-height:1.6;color:#7A6A55;margin:0 0 8px">Has pedido un Deshilachados en el <b>${cp}</b> (${distrito}). Confirma que eres tú y sumaremos tu voto al mapa de demanda de tu barrio.</p>
      </td></tr>
      <tr><td style="padding:12px 32px 4px"><a href="${url}" style="display:inline-block;background:#B03A2E;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:24px">Confirmar mi voto</a></td></tr>
      <tr><td style="padding:14px 32px 30px"><p style="font-size:13px;color:#7A6A55;margin:0">Si no has sido tú, ignora este correo y no pasará nada.</p></td></tr>
      <tr><td style="background:#EFE6D3;padding:18px 32px;text-align:center">
        <div style="font-size:12px;color:#7A6A55">@deshilachados.madrid · Madrid</div>
        <div style="font-size:11px;color:#7A6A55;margin-top:10px"><a href="${site}/privacidad" style="color:#7A6A55;text-decoration:underline">Privacidad</a> &middot; <a href="${site}/aviso-legal" style="color:#7A6A55;text-decoration:underline">Aviso legal</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
