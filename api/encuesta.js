// POST /api/encuesta  { promo_code?, fav_sandwich, bread, spice, side, size_pref, price_ok, comment, website(honeypot) }
// Guarda una respuesta de la encuesta en Supabase (tabla survey_responses).
// Reutiliza las mismas variables de entorno que /api/subscribe: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const FIELDS = ['promo_code', 'fav_sandwich', 'bread', 'spice', 'side', 'size_pref', 'price_ok', 'comment'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno de Supabase');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_request' });

  if (body.website) return res.status(200).json({ ok: true }); // honeypot: bot

  // recogemos solo los campos permitidos y limitamos longitudes
  const row = {};
  for (const f of FIELDS) {
    let v = body[f];
    if (v == null) continue;
    v = String(v).slice(0, f === 'comment' ? 1000 : 120).trim();
    if (v) row[f] = v;
  }

  // debe haber al menos una respuesta real (además del posible promo_code)
  const answered = FIELDS.filter((f) => f !== 'promo_code').some((f) => row[f]);
  if (!answered) return res.status(400).json({ ok: false, error: 'empty' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/survey_responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify([row]),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Supabase insert error', r.status, t);
      return res.status(500).json({ ok: false, error: 'db_error' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('encuesta error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};
