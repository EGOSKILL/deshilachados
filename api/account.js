// POST /api/account  { token }
// Valida el token (existe y no caducado) y devuelve los datos de la cuenta + promos activas.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: 'server_misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = (body?.token || '').trim();
  if (!token || token.length < 10) return res.status(400).json({ ok: false, error: 'no_token' });

  const H = { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

  try {
    // token válido?
    const tq = await fetch(`${SUPABASE_URL}/rest/v1/access_tokens?token=eq.${encodeURIComponent(token)}&select=email,expires_at`, { headers: H });
    const trows = tq.ok ? await tq.json() : [];
    if (!Array.isArray(trows) || trows.length === 0) return res.status(200).json({ ok: false, error: 'invalid' });
    const { email, expires_at } = trows[0];
    if (new Date(expires_at).getTime() < Date.now()) return res.status(200).json({ ok: false, error: 'expired' });

    // datos del suscriptor
    const sq = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=email,promo_code,redeemed`, { headers: H });
    const srows = sq.ok ? await sq.json() : [];
    const sub = (Array.isArray(srows) && srows[0]) || null;

    // promos activas
    const pq = await fetch(`${SUPABASE_URL}/rest/v1/promos?active=eq.true&select=title,description,code&order=sort.asc`, { headers: H });
    const promos = pq.ok ? await pq.json() : [];

    return res.status(200).json({
      ok: true,
      email,
      promo_code: sub ? sub.promo_code : null,
      redeemed: sub ? sub.redeemed : false,
      promos: Array.isArray(promos) ? promos : [],
    });
  } catch (err) {
    console.error('account error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};
