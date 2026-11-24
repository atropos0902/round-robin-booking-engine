import { App } from 'aws-cdk-lib';
import { BookingEventsStack } from './booking-events-stack';

const app = new App();
new BookingEventsStack(app, `rr-events-${app.node.tryGetContext('stage') ?? 'staging'}`, {
  stage: app.node.tryGetContext('stage') ?? 'staging',
  appUrl: app.node.tryGetContext('appUrl') ?? 'https://example.invalid',
  release: app.node.tryGetContext('release') ?? 'dev',
  incidentUrl: app.node.tryGetContext('incidentUrl'),
});
