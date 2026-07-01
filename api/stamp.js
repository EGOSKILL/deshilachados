// POST /api/stamp  { pin, action, code? }
// Panel del personal (protegido por STAFF_PIN). Acciones: get | add | redeem | create
// Requiere env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_PIN
const crypto = require('crypto');

const GOAL = 10; // cómete 10 y el 11 gratis
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  let s = '';
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `DS-${s}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_PIN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STAFF_PIN) return res.status(500).json({ ok: false, error: 'server_misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const pin = String(body?.pin || '');
  const action = String(body?.action || '');
  let code = String(body?.code || '').trim().toUpperCase();

  // PIN en tiempo constante para no filtrar por timing
  const a = Buffer.from(pin), b = Buffer.from(String(STAFF_PIN));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'bad_pin' });

  const H = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const getCard = async (c) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/loyalty?code=eq.${encodeURIComponent(c)}&select=code,email,stamps,free_available,free_total`, { headers: H });
    const rows = r.ok ? await r.json() : [];
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  };
  const patch = async (c, fields) => {
    fields.updated_at = new Date().toISOString();
    return fetch(`${SUPABASE_URL}/rest/v1/loyalty?code=eq.${encodeURIComponent(c)}`, {
      method: 'PATCH', headers: { ...H, 'Prefer': 'return=representation' }, body: JSON.stringify(fields),
    });
  };
  const logEvent = (c, act) => fetch(`${SUPABASE_URL}/rest/v1/stamp_events`, {
    method: 'POST', headers: { ...H, 'Prefer': 'return=minimal' }, body: JSON.stringify([{ code: c, action: act }]),
  }).catch(() => {});

  try {
    if (action === 'create') {
      // genera un código único para un cliente sin cuenta
      let c, tries = 0;
      do { c = genCode(); tries++; } while (await getCard(c) && tries < 6);
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/loyalty`, {
        method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
        body: JSON.stringify([{ code: c, stamps: 0, free_available: 0, free_total: 0 }]),
      });
      if (!ins.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      await logEvent(c, 'create');
      return res.status(200).json({ ok: true, card: { code: c, stamps: 0, free_available: 0, goal: GOAL } });
    }

    if (!code) return res.status(400).json({ ok: false, error: 'no_code' });
    const card = await getCard(code);

    if (action === 'get') {
      if (!card) return res.status(200).json({ ok: true, found: false });
      return res.status(200).json({ ok: true, found: true, card: { ...card, goal: GOAL } });
    }

    if (action === 'add') {
      if (!card) return res.status(200).json({ ok: true, found: false });
      let stamps = (card.stamps || 0) + 1;
      let free_available = card.free_available || 0, free_total = card.free_total || 0, reward = false;
      if (stamps >= GOAL) { stamps = 0; free_available += 1; free_total += 1; reward = true; }
      const up = await patch(code, { stamps, free_available, free_total });
      if (!up.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      await logEvent(code, 'stamp');
      return res.status(200).json({ ok: true, found: true, reward, card: { code, stamps, free_available, free_total, goal: GOAL } });
    }

    if (action === 'redeem') {
      if (!card) return res.status(200).json({ ok: true, found: false });
      if ((card.free_available || 0) <= 0) return res.status(200).json({ ok: true, found: true, error: 'no_reward', card: { ...card, goal: GOAL } });
      const free_available = card.free_available - 1;
      const up = await patch(code, { free_available });
      if (!up.ok) return res.status(500).json({ ok: false, error: 'db_error' });
      await logEvent(code, 'redeem');
      return res.status(200).json({ ok: true, found: true, card: { ...card, free_available, goal: GOAL } });
    }

    return res.status(400).json({ ok: false, error: 'bad_action' });
  } catch (err) {
    console.error('stamp error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
};
