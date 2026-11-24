import { WebhookAlertChannel } from 'checkly/constructs';

const source = process.env.INCIDENT_ALERT_SOURCE_ID ?? 'missing';

/** Opens and closes an alert in incident.io. The alert route over there turns it into an incident. */
export const incident = new WebhookAlertChannel('incident-io', {
  name: 'incident.io',
  method: 'POST',
  url: `https://api.incident.io/v2/alert_events/http/${source}`,
  headers: [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'Authorization', value: 'Bearer {{INCIDENT_ALERT_TOKEN}}' },
  ],
  template: JSON.stringify({
    title: '{{CHECK_NAME}}',
    description: '{{ALERT_TITLE}}',
    deduplication_key: 'checkly-{{CHECK_ID}}',
    status: '{{#contains ALERT_TYPE "RECOVERY"}}resolved{{else}}firing{{/contains}}',
    source_url: '{{RESULT_LINK}}',
    metadata: { location: '{{RUN_LOCATION}}', check: '{{CHECK_ID}}' },
  }),
  sendFailure: true,
  sendRecovery: true,
  sendDegraded: false,
});

export const alertChannels = [incident];
