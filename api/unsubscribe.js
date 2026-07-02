// POST /api/unsubscribe  { code }  -> marca al suscriptor como dado de baja (por su promo_code)
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: 'server_misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const code = (body?.code || '').trim().toUpperCase();
  if (!code || code.length < 4) return res.status(400).json({ ok: false, error: 'no_code' });

  const H = { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?promo_code=eq.${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { ...H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ unsubscribed: true, unsubscribed_at: new Date().toISOString() }),
    });
    if (!r.ok) { console.error('unsubscribe error', r.status, await r.text()); return res.status(500).json({ ok: false, error: 'db_error' }); }
    // Respondemos ok aunque el código no exista (no revelamos la lista)
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('unsubscribe error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};
