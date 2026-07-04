// POST /api/zonas  { pin, action:'list' }
// Panel interno (protegido por STAFF_PIN): devuelve los votos CONFIRMADOS del mapa de demanda.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_PIN
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok:false, error:'method_not_allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_PIN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STAFF_PIN) return res.status(500).json({ ok:false, error:'server_misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const pin = String(body?.pin || '');

  const a = Buffer.from(pin), b = Buffer.from(String(STAFF_PIN));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok:false, error:'bad_pin' });

  const H = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/zonas_interes?confirmed=eq.true&select=email,codigo_postal,distrito,zona_texto,referred_by,created_at&order=created_at.asc`;
    const r = await fetch(url, { headers: H });
    if (!r.ok) { const t = await r.text(); console.error('zonas list error', r.status, t); return res.status(500).json({ ok:false, error:'db_error' }); }
    const rows = await r.json();

    // conteo de pendientes (sin confirmar), solo el total con cabecera de rango
    let pending = 0;
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/zonas_interes?confirmed=eq.false&select=id`, { headers: { ...H, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } });
      const cr = pr.headers.get('content-range'); // p.ej. "0-0/12"
      if (cr && cr.includes('/')) pending = parseInt(cr.split('/')[1], 10) || 0;
    } catch (e) {}

    return res.status(200).json({ ok:true, rows: Array.isArray(rows) ? rows : [], pending });
  } catch (err) {
    console.error('zonas error', err);
    return res.status(500).json({ ok:false, error:'unexpected' });
  }
};
