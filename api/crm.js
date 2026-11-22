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

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '');

// Compact view sized for an AI to read in one go: deals grouped by stage with
// contact names inline, recent activity as plain text, no internal ids/timestamps.
function summarize(full) {
  // Defaults mirror STAGE_LABELS in app.js; custom names in settings override them.
  const labels = {
    discovery: 'Discovery',
    qualification: 'Qualification',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
    closed_won: 'Closed Won',
    closed_lost: 'Lost/Inactive',
    ...(full.settings.stageLabels || {}),
  };
  const contactsById = {};
  for (const c of full.contacts) contactsById[c.id] = c;
  const contactLabel = (id) => {
    const c = contactsById[id];
    if (!c) return null;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    return [name, c.title, c.email].filter(Boolean).join(' | ');
  };

  // Pre-seed in board order so the pipeline reads left-to-right.
  const stages = {};
  for (const key of ['discovery', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']) {
    stages[labels[key]] = { count: 0, totalValue: 0, deals: [] };
  }
  for (const d of full.deals) {
    const stage = labels[d.stage] || d.stage || 'Unknown';
    const ids = d.contactIds && d.contactIds.length ? d.contactIds : d.contactId ? [d.contactId] : [];
    const deal = {
      name: d.name,
      value: d.value,
      owner: d.owner,
      type: d.type || undefined,
      followUpDate: d.followUpDate || undefined,
      contacts: ids.map(contactLabel).filter(Boolean),
      notes: d.notes || undefined,
      latestComment: Array.isArray(d.comments) && d.comments.length
        ? stripHtml(d.comments[d.comments.length - 1].text || d.comments[d.comments.length - 1])
        : undefined,
      updatedAt: d.updatedAt ? String(d.updatedAt).slice(0, 10) : undefined,
    };
    (stages[stage] = stages[stage] || { count: 0, totalValue: 0, deals: [] });
    stages[stage].count += 1;
    stages[stage].totalValue += Number(d.value) || 0;
    stages[stage].deals.push(deal);
  }

  return {
    fetchedAt: full.fetchedAt,
    note: 'Summary view. Use ?view=full, or view=deals|contacts|activities|settings, for raw data.',
    totals: { deals: full.deals.length, contacts: full.contacts.length },
    mrrGoal: full.settings.mrrGoal,
    latestMrr: full.settings.mrrHistory.length ? full.settings.mrrHistory[full.settings.mrrHistory.length - 1] : null,
    pipeline: stages,
    recentActivity: full.activities.slice(0, 20).map((a) => `${String(a.time).slice(0, 10)}: ${stripHtml(a.text)}`),
  };
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
    const full = {
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
    };

    const view = req.query.view || 'summary';
    if (view === 'full') {
      res.status(200).json(full);
    } else if (['deals', 'contacts', 'activities', 'settings'].includes(view)) {
      res.status(200).json({ fetchedAt: full.fetchedAt, [view]: full[view] });
    } else {
      res.status(200).json(summarize(full));
    }
  } catch (err) {
    console.error('crm api error', err);
    res.status(500).json({ error: 'Failed to read CRM data' });
  }
}

module.exports = handler;
module.exports.fieldsToObject = fieldsToObject;
