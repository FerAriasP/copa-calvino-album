const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const FROM_NAME = 'Copa Calvino';
const SITE_URL = process.env.SITE_URL || '';

const STICKER_PARENT_BUCKET = 'sticker-packs';
const RANDOM_STICKER_COUNT = 10;
const MAX_ATTACHMENTS_SIZE_BYTES = 18 * 1024 * 1024;

const PACK_NAMES = [
  'Equipo Submarino Amarillo Pack',
  'Equipo Hammers Pack',
  'Equipo Blanco Pack',
  'Equipo Rojo Pack',
  'Equipo San Jose A Pack',
  'Equipo Verde Pack',
  'Las Leyendas Pack'
];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    assertEnv();

    const payload = JSON.parse(event.body || '{}');

    const firstName = getValue(payload, ['Name', 'Nombre', 'First name', 'First Name']);
    const lastName = getValue(payload, ['Last Name', 'Apellido', 'Apellidos']);
    const email = getValue(payload, ['Correo electrónico', 'Email', 'Correo Electronico']);
    const order = getValue(payload, ['Compra', 'Tipo de pedido', 'Items Buyed']);
    const deliveryMethod = getValue(payload, ['¿Cómo quieres recibir tus stickers?', 'Como quieres recibir tus stickers?', 'Entrega de stickers']);

    if (!email) throw new Error('Missing email');
    if (!order) throw new Error('Missing order type');

    const orderKey = normalize(order);
    const deliveryKey = normalize(deliveryMethod);

    let album = null;
    let albumLink = '';

    if (
      orderKey === 'album lleno' ||
      orderKey === 'album completo' ||
      orderKey === 'solo album' ||
      orderKey === 'album solo'
    ) {
      const code = createAlbumCode(firstName, lastName);
      const siteBase = SITE_URL.replace(/\/$/, '');
      albumLink = `${siteBase}/album/${encodeURIComponent(code)}`;

      album = await createAlbumRecord({
        code,
        firstName,
        lastName,
        email,
        order,
        deliveryMethod,
        albumLink
      });
    }

    if (orderKey === 'album lleno' || orderKey === 'album completo') {
      if (deliveryKey === 'whatsapp') {
        await sendEmail({
          to: email,
          subject: 'Tu Álbum Completo - Copa Calvino',
          html: albumLlenoWhatsappEmailTemplate(firstName, lastName, albumLink)
        });
      } else {
        await sendAlbumLlenoEmails(email, firstName, lastName, albumLink);
      }
    }

    if (orderKey === 'solo album' || orderKey === 'album solo') {
      await sendEmail({
        to: email,
        subject: 'Tu álbum - Copa Calvino',
        html: albumSoloEmailTemplate(firstName, lastName, order, albumLink)
      });
    }

    if (orderKey === 'stickers') {
      const randomStickers = await getRandomStickerAttachments(RANDOM_STICKER_COUNT);

      await sendEmail({
        to: email,
        subject: 'Tus stickers - Copa Calvino',
        html: stickersEmailTemplate(firstName, lastName, order),
        attachments: randomStickers
      });
    }

    return jsonResponse(200, {
      ok: true,
      albumLink,
      albumId: album ? album.id : null
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(500, { error: error.message || 'Unknown error' });
  }
};

function assertEnv() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  if (!BREVO_API_KEY) throw new Error('Missing BREVO_API_KEY');
  if (!FROM_EMAIL) throw new Error('Missing FROM_EMAIL');
  if (!SITE_URL) throw new Error('Missing SITE_URL');
}

function getValue(payload, labels) {
  const fields = [];

  if (payload && payload.data && Array.isArray(payload.data.fields)) fields.push(...payload.data.fields);
  if (payload && Array.isArray(payload.fields)) fields.push(...payload.fields);
  if (payload && payload.form_response && Array.isArray(payload.form_response.answers)) fields.push(...payload.form_response.answers);

  const normalizedLabels = labels.map(normalize);

  for (const field of fields) {
    const possibleNames = [field.label, field.title, field.name, field.key, field.question, field.id]
      .filter(Boolean)
      .map(normalize);

    if (possibleNames.some(name => normalizedLabels.includes(name))) {
      return normalizeFieldValue(field.value ?? field.answer ?? field.text ?? field.email ?? field.choice ?? field.choices ?? '');
    }
  }

  for (const key of Object.keys(payload || {})) {
    if (normalizedLabels.includes(normalize(key))) return normalizeFieldValue(payload[key]);
  }

  return '';
}

function normalizeFieldValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    if (value.label) return String(value.label);
    if (value.value) return String(value.value);
    if (value.name) return String(value.name);
    return JSON.stringify(value);
  }
  return String(value).trim();
}

async function createAlbumRecord({ code, firstName, lastName, email, order, deliveryMethod, albumLink }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/albums`, {
    method: 'POST',
    headers: supabaseHeaders({ prefer: 'return=representation' }),
    body: JSON.stringify({
      code,
      first_name: firstName,
      last_name: lastName,
      email,
      order_type: order,
      delivery_method: deliveryMethod,
      album_link: albumLink
    })
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Create album failed: ${text}`);

  return JSON.parse(text)[0];
}

async function sendAlbumLlenoEmails(email, firstName, lastName, albumLink) {
  let albumLinkAlreadySent = false;

  for (const packName of PACK_NAMES) {
    const files = await listStickerFiles(packName);
    const batches = await createAttachmentBatches(files);

    for (const batch of batches) {
      const includeAlbumLink = !albumLinkAlreadySent;

      await sendEmail({
        to: email,
        subject: includeAlbumLink ? 'Tu Álbum Completo - Copa Calvino' : `${packName} - Copa Calvino`,
        html: includeAlbumLink
          ? albumLlenoFirstEmailTemplate(firstName, lastName, albumLink, packName)
          : packEmailTemplate(firstName, lastName, packName),
        attachments: batch
      });

      albumLinkAlreadySent = true;
    }
  }
}

function emailWrapper(content) {
  return `
    <div style="font-family: Arial, sans-serif; padding: 32px 24px; background: #020617;">
      <div style="max-width: 600px; margin: auto; background: #f4f4f4; padding: 28px; border-radius: 14px; color: #111111;">
        ${content}
      </div>
    </div>
  `;
}

function albumButton(albumLink) {
  return `
    <p style="text-align: center; margin: 32px 0;">
      <a href="${albumLink}"
         style="background: #000000; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; border: none;">
        Abrir Álbum
      </a>
    </p>
  `;
}

function albumLlenoFirstEmailTemplate(firstName, lastName, albumLink, packName) {
  return emailWrapper(`
    <h2>Hola ${escapeHtml(firstName)} ${escapeHtml(lastName)},</h2>
    <p>¡Gracias por tu compra!</p>
    <p>Aquí está tu álbum personalizado. Guarda este correo para volver a entrar a tu álbum cuando quieras.</p>
    ${albumButton(albumLink)}
    <p>Adjuntamos tus stickers de: <strong>${escapeHtml(packName)}</strong>.</p>
    <p>¡Gracias por apoyar la Copa Calvino!</p>
  `);
}

function albumLlenoWhatsappEmailTemplate(firstName, lastName, albumLink) {
  return emailWrapper(`
    <h2>Hola ${escapeHtml(firstName)} ${escapeHtml(lastName)},</h2>
    <p>¡Gracias por tu compra!</p>
    <p>Aquí está tu álbum personalizado. Guarda este correo para volver a entrar a tu álbum cuando quieras.</p>
    ${albumButton(albumLink)}
    <p>Los stickers serán enviados por WhatsApp.</p>
    <p>¡Gracias por apoyar la Copa Calvino!</p>
  `);
}

function packEmailTemplate(firstName, lastName, packName) {
  return emailWrapper(`
    <h2>Hola ${escapeHtml(firstName)} ${escapeHtml(lastName)},</h2>
    <p>Adjuntamos tus stickers de: <strong>${escapeHtml(packName)}</strong>.</p>
    <p>¡Gracias por apoyar la Copa Calvino!</p>
  `);
}

function albumSoloEmailTemplate(firstName, lastName, order, albumLink) {
  return emailWrapper(`
    <h2>Hola ${escapeHtml(firstName)} ${escapeHtml(lastName)},</h2>
    <p>Gracias por tu compra.</p>
    <p>Recibimos tu pedido de: <strong>${escapeHtml(order)}</strong>.</p>
    <p>Tu álbum personalizado de la Copa Calvino ya está listo.</p>
    ${albumButton(albumLink)}
    <p>Guarda este correo para volver a entrar a tu álbum cuando quieras.</p>
    <p>¡Gracias por apoyar la Copa Calvino!</p>
  `);
}

function stickersEmailTemplate(firstName, lastName, order) {
  return emailWrapper(`
    <h2>Hola ${escapeHtml(firstName)} ${escapeHtml(lastName)},</h2>
    <p>Gracias por tu compra.</p>
    <p>Recibimos tu pedido de: <strong>${escapeHtml(order)}</strong>.</p>
    <p>Adjuntamos tus stickers a este correo.</p>
    <p>¡Gracias por apoyar la Copa Calvino!</p>
  `);
}

async function getRandomStickerAttachments(count) {
  const allFiles = [];

  for (const packName of PACK_NAMES) {
    const files = await listStickerFiles(packName);
    allFiles.push(...files);
  }

  shuffleArray(allFiles);

  const selected = allFiles.slice(0, count);

  return Promise.all(selected.map(fileToAttachment));
}

async function listStickerFiles(packName) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${STICKER_PARENT_BUCKET}`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      prefix: `${packName}/`,
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    })
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Could not list ${packName}: ${text}`);

  const items = JSON.parse(text);

  return items
    .filter(item => item && item.name && isImageName(item.name))
    .map(item => ({
      name: item.name,
      path: `${packName}/${item.name}`,
      size: item.metadata && item.metadata.size ? Number(item.metadata.size) : 0
    }));
}

async function createAttachmentBatches(files) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const file of files) {
    const attachment = await fileToAttachment(file);
    const size = file.size || Buffer.byteLength(attachment.content, 'base64');

    if (currentBatch.length > 0 && currentSize + size > MAX_ATTACHMENTS_SIZE_BYTES) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(attachment);
    currentSize += size;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function fileToAttachment(file) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${STICKER_PARENT_BUCKET}/${encodePath(file.path)}`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not fetch sticker ${file.path}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    name: file.name,
    content: buffer.toString('base64')
  };
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  const body = {
    sender: {
      name: FROM_NAME,
      email: FROM_EMAIL
    },
    to: [
      {
        email: to
      }
    ],
    subject,
    htmlContent: html
  };

  if (attachments.length > 0) {
    body.attachment = attachments;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Brevo failed: ${text}`);
  }
}

function supabaseHeaders(options = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  return headers;
}

function createAlbumCode(firstName, lastName) {
  const cleanName = normalize(`${firstName}-${lastName}`).replace(/[^a-z0-9]/g, '');
  const random = Math.random().toString(36).slice(2, 10);
  return `${cleanName}-${random}`;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isImageName(name) {
  const clean = String(name || '').toLowerCase();
  return clean.endsWith('.jpg') || clean.endsWith('.jpeg') || clean.endsWith('.png');
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}
