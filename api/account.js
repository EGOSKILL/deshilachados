// POST /api/account
//   { token }  -> valida enlace mágico y devuelve datos de cuenta + promos + tarjeta de sellos
//   { code }   -> consulta pública SOLO de sellos (para quien no tiene cuenta), sin datos personales
const GOAL = 10;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: 'server_misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = (body?.token || '').trim();
  const codeOnly = (body?.code || '').trim().toUpperCase();

  const H = { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  const getCardByCode = async (c) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/loyalty?code=eq.${encodeURIComponent(c)}&select=code,stamps,free_available`, { headers: H });
    const rows = r.ok ? await r.json() : []; return Array.isArray(rows) && rows[0] ? rows[0] : null;
  };

  try {
    // --- Consulta pública de sellos por código (sin login) ---
    if (!token && codeOnly) {
      const card = await getCardByCode(codeOnly);
      if (!card) return res.status(200).json({ ok: true, mode: 'stamps', found: false });
      return res.status(200).json({ ok: true, mode: 'stamps', found: true, loyalty: { ...card, goal: GOAL } });
    }

    if (!token || token.length < 10) return res.status(400).json({ ok: false, error: 'no_token' });

    // --- Enlace mágico ---
    const tq = await fetch(`${SUPABASE_URL}/rest/v1/access_tokens?token=eq.${encodeURIComponent(token)}&select=email,expires_at`, { headers: H });
    const trows = tq.ok ? await tq.json() : [];
    if (!Array.isArray(trows) || trows.length === 0) return res.status(200).json({ ok: false, error: 'invalid' });
    const { email, expires_at } = trows[0];
    if (new Date(expires_at).getTime() < Date.now()) return res.status(200).json({ ok: false, error: 'expired' });

    // Suscriptor
    const sq = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=email,promo_code,redeemed`, { headers: H });
    const srows = sq.ok ? await sq.json() : [];
    const sub = (Array.isArray(srows) && srows[0]) || null;

    // Promos activas
    const pq = await fetch(`${SUPABASE_URL}/rest/v1/promos?active=eq.true&select=title,description,code&order=sort.asc`, { headers: H });
    const promos = pq.ok ? await pq.json() : [];

    // Tarjeta de sellos: por email o por su código; si no existe, se crea con su propio código
    let loyalty = null;
    const promoCode = sub ? sub.promo_code : null;
    const orFilter = promoCode
      ? `or=(email.eq.${encodeURIComponent(email)},code.eq.${encodeURIComponent(promoCode)})`
      : `email=eq.${encodeURIComponent(email)}`;
    const lq = await fetch(`${SUPABASE_URL}/rest/v1/loyalty?${orFilter}&select=code,stamps,free_available&limit=1`, { headers: H });
    const lrows = lq.ok ? await lq.json() : [];
    if (Array.isArray(lrows) && lrows[0]) {
      loyalty = lrows[0];
    } else if (promoCode) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/loyalty`, {
        method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
        body: JSON.stringify([{ code: promoCode, email, stamps: 0, free_available: 0, free_total: 0 }]),
      });
      if (ins.ok) { const rows = await ins.json(); loyalty = (rows && rows[0]) ? { code: rows[0].code, stamps: 0, free_available: 0 } : { code: promoCode, stamps: 0, free_available: 0 }; }
    }

    return res.status(200).json({
      ok: true,
      email,
      promo_code: promoCode,
      redeemed: sub ? sub.redeemed : false,
      promos: Array.isArray(promos) ? promos : [],
      loyalty: loyalty ? { ...loyalty, goal: GOAL } : null,
    });
  } catch (err) {
    console.error('account error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};
