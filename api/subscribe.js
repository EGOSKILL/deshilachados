// POST /api/subscribe  { email }
// Guarda el email en Supabase (con un código 2x1 único) y envía el email de bienvenida con Resend.
// Variables de entorno necesarias (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL
//   (opcional) SITE_URL  → por defecto https://deshilachados.com

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I)

function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return '2X1-' + s;
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL } = process.env;
  let SITE_URL = (process.env.SITE_URL || 'https://www.deshilachados.com').trim();
  if (!/^https?:\/\//i.test(SITE_URL)) SITE_URL = 'https://' + SITE_URL;   // asegura esquema
  SITE_URL = SITE_URL.replace(/\/+$/, '');                                  // quita barra(s) final(es)
  SITE_URL = SITE_URL.replace('://deshilachados.com', '://www.deshilachados.com'); // apex no resuelve → www
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !FROM_EMAIL) {
    console.error('Faltan variables de entorno');
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  // body puede venir como objeto (Vercel lo parsea) o como string
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = (body?.email || '').trim().toLowerCase();
  const website = body?.website; // honeypot: si viene relleno, es un bot

  if (website) return res.status(200).json({ ok: true }); // silencioso para bots
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'invalid_email' });

  const code = makeCode();

  try {
    // 1) Insertar en Supabase; si el email ya existe, se ignora (no se reenvía correo)
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?on_conflict=email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify([{ email, promo_code: code, source: 'landing' }]),
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      console.error('Supabase insert error', insertRes.status, t);
      return res.status(500).json({ ok: false, error: 'db_error' });
    }

    const rows = await insertRes.json();
    const isNew = Array.isArray(rows) && rows.length > 0;

    // Si ya estaba apuntado, no reenviamos el correo (evita spam). Respondemos amable.
    if (!isNew) {
      return res.status(200).json({ ok: true, already: true });
    }

    // 2) Enviar el email de bienvenida con Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL, // p.ej. "Deshilachados <hola@deshilachados.com>"
        to: [email],
        subject: '¡Gracias! Aquí tienes tu 2x1 · Deshilachados',
        html: welcomeEmail(code, SITE_URL),
      }),
    });

    if (!emailRes.ok) {
      const t = await emailRes.text();
      console.error('Resend error', emailRes.status, t);
      // El email quedó guardado; avisamos de que el correo falló pero no rompemos el alta
      return res.status(200).json({ ok: true, code, emailSent: false });
    }

    return res.status(200).json({ ok: true, code, emailSent: true });
  } catch (err) {
    console.error('subscribe error', err);
    return res.status(500).json({ ok: false, error: 'unexpected' });
  }
}

function welcomeEmail(code, site) {
  const survey = `${site}/encuesta?c=${encodeURIComponent(code)}`;
  const img = (name, alt) => `<img src="${site}/img/${name}" alt="${alt}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0">`;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#FAF6EE;font-family:Arial,Helvetica,sans-serif;color:#2B2622">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EE;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E3D6BD;border-radius:16px;overflow:hidden">
        <tr><td style="background:#2B2622;padding:24px 32px;text-align:center">
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#FAF6EE;letter-spacing:.5px">DESHILA<span style="color:#D4881F">CHADOS</span></div>
          <div style="font-size:11px;letter-spacing:2px;color:#D4881F;margin-top:4px">SÁNDWICHES · MADRID</div>
        </td></tr>
        <tr><td style="padding:0">${img('email-local.jpg','Nuestra esquina en Madrid, pronto')}</td></tr>
        <tr><td style="padding:30px 32px 6px">
          <h1 style="font-family:Georgia,serif;font-size:25px;color:#2B2622;margin:0 0 12px">¡Gracias por apuntarte!</h1>
          <p style="font-size:16px;line-height:1.6;color:#7A6A55;margin:0 0 8px">Nos alegra que quieras probar Deshilachados. Te avisaremos en cuanto abramos nuestra primera esquina en Madrid.</p>
          <p style="font-size:16px;line-height:1.6;color:#7A6A55;margin:0 0 22px">Y por confiar desde el principio, aquí va tu regalo de bienvenida:</p>
        </td></tr>
        <tr><td style="padding:0 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFE6D3;border:2px dashed #B03A2E;border-radius:14px">
            <tr><td style="padding:22px;text-align:center">
              <div style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#8C2D22;font-weight:bold">2x1 en tu primera compra</div>
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:bold;color:#B03A2E;margin:8px 0 4px;letter-spacing:1px">${code}</div>
              <div style="font-size:13px;color:#7A6A55">Enseña este código al pedir. Llévate 2 sándwiches al precio de 1.</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px 0"><a href="${site}" style="display:inline-block;background:#B03A2E;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:24px">Ver la carta</a></td></tr>

        <tr><td style="padding:26px 32px 10px"><hr style="border:none;border-top:1px solid #E3D6BD;margin:0"></td></tr>
        <tr><td style="padding:6px 0 0">${img('email-sandwich.jpg','Sándwich de pollo deshilachado')}</td></tr>
        <tr><td style="padding:22px 32px 34px">
          <h2 style="font-family:Georgia,serif;font-size:21px;color:#2B2622;margin:0 0 8px">Y una última cosa…</h2>
          <p style="font-size:15px;line-height:1.6;color:#7A6A55;margin:0 0 18px">Aún no hemos abierto, así que estás a tiempo de opinar. Cuéntanos cómo te gusta el sándwich y afinamos la carta antes del primer día. Es 1 minuto.</p>
          <a href="${survey}" style="display:inline-block;background:#D4881F;color:#2B2622;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:24px">Cuéntanos cómo te gusta →</a>
        </td></tr>

        <tr><td style="background:#EFE6D3;padding:18px 32px;text-align:center">
          <div style="font-size:12px;color:#7A6A55">@deshilachados.madrid · Madrid</div>
          <div style="font-size:12px;margin-top:8px"><a href="${site}/mi-cuenta" style="color:#B03A2E;text-decoration:none;font-weight:bold">Ver mi cuenta</a></div>
          <div style="font-size:11px;color:#7A6A55;margin-top:6px">Válido en la primera compra. Un uso por persona. Sujeto a la apertura de nuestros locales.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
