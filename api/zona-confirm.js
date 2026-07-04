// GET /api/zona-confirm?t=TOKEN
// Segundo paso del doble opt-in: valida el token, marca el voto como confirmado,
// registra el referido (si vino de un enlace válido) y redirige a /zona con el estado.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (opcional) SITE_URL

module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  let SITE_URL = (process.env.SITE_URL || 'https://www.deshilachados.com').trim();
  if (!/^https?:\/\//i.test(SITE_URL)) SITE_URL = 'https://' + SITE_URL;
  SITE_URL = SITE_URL.replace(/\/+$/, '').replace('://deshilachados.com', '://www.deshilachados.com');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send('server_misconfigured');

  const token = (req.query?.t || '').toString();
  const bad = () => res.redirect(302, `${SITE_URL}/zona?err=1`);
  if (!token || token.length < 16) return bad();

  const H = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const q = await fetch(`${SUPABASE_URL}/rest/v1/zonas_interes?confirm_token=eq.${encodeURIComponent(token)}&select=email,codigo_postal,promo_code,referred_by,confirmed`, { headers: H });
    const rows = q.ok ? await q.json() : [];
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return bad();

    if (!row.confirmed) {
      const patch = await fetch(`${SUPABASE_URL}/rest/v1/zonas_interes?confirm_token=eq.${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ confirmed: true, confirmed_at: new Date().toISOString() }),
      });
      if (!patch.ok) { const t = await patch.text(); console.error('confirm patch error', patch.status, t); }

      // registrar el referido en la tabla compartida (log genérico), una sola vez
      if (row.referred_by) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/referrals?on_conflict=friend_email`, {
            method: 'POST',
            headers: { ...H, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify([{ referrer_code: row.referred_by, friend_email: row.email }]),
          });
        } catch (e) { console.error('referral log error', e); }
      }
    }

    const c = encodeURIComponent(row.codigo_postal);
    const code = encodeURIComponent(row.promo_code || '');
    return res.redirect(302, `${SITE_URL}/zona?ok=1&cp=${c}&code=${code}`);
  } catch (err) {
    console.error('zona-confirm error', err);
    return bad();
  }
};
