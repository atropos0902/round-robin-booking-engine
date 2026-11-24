// Raises an alert in incident.io when the release check fails right after a deploy.
const { INCIDENT_ALERT_SOURCE_ID, INCIDENT_ALERT_TOKEN, RELEASE = 'unknown', RUN_URL, INCIDENT_API = 'https://api.incident.io' } = process.env;
if (!INCIDENT_ALERT_SOURCE_ID || !INCIDENT_ALERT_TOKEN) {
  console.error('INCIDENT_ALERT_SOURCE_ID and INCIDENT_ALERT_TOKEN are needed');
  process.exit(2);
}
const response = await fetch(`${INCIDENT_API}/v2/alert_events/http/${INCIDENT_ALERT_SOURCE_ID}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${INCIDENT_ALERT_TOKEN}` },
  body: JSON.stringify({
    title: 'The release check failed',
    description: `Booking and cancelling a slot failed after release ${RELEASE}. Runbook: docs/runbooks/release-check-failed.md`,
    deduplication_key: `release-${RELEASE}`,
    status: 'firing',
    source_url: RUN_URL,
    metadata: { release: RELEASE },
  }),
});
if (!response.ok) {
  console.error(`incident.io answered ${response.status}`);
  process.exit(1);
}
console.log('Alert raised');
