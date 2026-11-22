# Paid Creative CRM

Static site (`index.html`, `app.js`, `styles.css`) hosted on Vercel (project `paidcreativecrm`),
with data in Firebase Firestore (project `paidcreativecrm`, collection `crm`, docs
`deals`, `contacts`, `activities`, `settings`, each holding an `items` array except `settings`).

## Reading live CRM data

`GET /api/crm` (in `api/crm.js`) returns live deals, contacts, activities and pipeline
settings as JSON. It is read-only and requires the `CRM_READ_KEY` secret, either as
`?key=<CRM_READ_KEY>` or `Authorization: Bearer <CRM_READ_KEY>`.

To use it from Claude with the Vercel MCP connected:
1. Read `CRM_READ_KEY` from the `paidcreativecrm` project's environment variables.
2. Fetch `https://<production domain>/api/crm?key=<CRM_READ_KEY>`
   (e.g. with `web_fetch_vercel_url`).

By default it returns a compact summary (deals grouped by stage with contacts inline,
MRR, recent activity). Add `&view=full` for all raw data, or `&view=deals|contacts|activities|settings`
for one section.

The function signs in to Firebase as the bot user in `CRM_BOT_EMAIL` / `CRM_BOT_PASSWORD`
(Vercel env vars) and reads Firestore over REST. Deal `stage` values are internal keys;
map them to display names with `settings.stageLabels`.
