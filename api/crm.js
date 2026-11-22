// Read-only CRM data endpoint for Claude (and other trusted tools).
//
//   GET /api/crm?key=<CRM_READ_KEY>
//   (or send the key as "Authorization: Bearer <CRM_READ_KEY>")
//
// Returns live deals, contacts, activities and pipeline settings from Firestore.
// The function signs in to Firebase as a dedicated bot user (email/password)
// and reads Firestore over REST, so no service account key is needed.
//
// Vercel environment variables:
//   CRM_READ_KEY       - long random secret; callers must present it
//   CRM_BOT_EMAIL      - Firebase Auth email of the bot user
//   CRM_BOT_PASSWORD   - Firebase Auth password of the bot user
//
// This endpoint never writes anything.

const crypto = require('crypto');

// Public web config (same values as in app.js; not secrets).
const FIREBASE_API_KEY = 'AIzaSyDgt1GnnX0Uchtohg4yW_0iqBnSOmw9Er0';
const PROJECT_ID = 'paidcreativecrm';

function keyMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Convert a Firestore REST "Value" into plain JSON.
function fromFirestore(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestore);
  if ('mapValue' in v) return fieldsToObject(v.mapValue.fields);
  return null;
}

function fieldsToObject(fields) {
  const out = {};
  for (const [k, val] of Object.entries(fields || {})) out[k] = fromFirestore(val);
  return out;
}

async function signInBot() {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.CRM_BOT_EMAIL,
        password: process.env.CRM_BOT_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  const data = await r.json();
  if (!r.ok) throw new Error('Bot sign-in failed: ' + JSON.stringify(data.error || data));
  return data.idToken;
}

async function readCrmCollection(idToken) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/crm?pageSize=100`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error('Firestore read failed: ' + JSON.stringify(data.error || data));
  const docs = {};
  for (const doc of data.documents || []) {
    const id = doc.name.split('/').pop();
    docs[id] = fieldsToObject(doc.fields);
  }
  return docs;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = req.headers.authorization || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.key;
  if (!keyMatches(provided, process.env.CRM_READ_KEY)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!process.env.CRM_BOT_EMAIL || !process.env.CRM_BOT_PASSWORD) {
    res.status(500).json({ error: 'CRM bot credentials are not configured' });
    return;
  }

  try {
    const docs = await readCrmCollection(await signInBot());
    const settings = docs.settings || {};
    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      deals: (docs.deals && docs.deals.items) || [],
      contacts: (docs.contacts && docs.contacts.items) || [],
      activities: (docs.activities && docs.activities.items) || [],
      // Only pipeline-related settings are exposed.
      settings: {
        stageLabels: settings.stageLabels || null,
        mrrGoal: settings.mrrGoal != null ? settings.mrrGoal : null,
        mrrHistory: settings.mrrHistory || [],
      },
    });
  } catch (err) {
    console.error('crm api error', err);
    res.status(500).json({ error: 'Failed to read CRM data' });
  }
}

module.exports = handler;
module.exports.fieldsToObject = fieldsToObject;
