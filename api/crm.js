// Read-only CRM data endpoint for Claude (and other trusted tools).
//
//   GET /api/crm?key=<CRM_READ_KEY>
//
// Returns live deals, contacts, activities and pipeline settings from Firestore.
// Requires two Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  - the full JSON of a Firebase service account key
//   CRM_READ_KEY              - a long random secret; requests must include it
//
// This endpoint never writes anything.

const crypto = require('crypto');
const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

function keyMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
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

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not configured' });
    return;
  }

  try {
    const snapshot = await getDb().collection('crm').get();
    const docs = {};
    snapshot.forEach((doc) => { docs[doc.id] = doc.data() || {}; });

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
};
