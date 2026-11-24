import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CONSUMERS as WORKER_NAMES } from '../../apps/workers/src/consumers';
import { BookingEventsStack, CONSUMERS } from '../src/booking-events-stack';

const stack = new BookingEventsStack(
  // Leaves the functions unbundled, the bundle has a test of its own.
  new App({ context: { 'aws:cdk:bundling-stacks': [] } }),
  'test',
  { stage: 'test', appUrl: 'https://app.test', release: 'abc', incidentUrl: 'https://alerts.test/hook' },
);
const template = Template.fromStack(stack);

describe('stack', () => {
  it('has a queue for every consumer the workers know', () => {
    expect([...CONSUMERS]).toEqual([...WORKER_NAMES]);
    template.resourceCountIs('AWS::SQS::Queue', CONSUMERS.length * 2);
  });

  it('gives every queue a dead-letter queue and a visibility timeout longer than its function', () => {
    for (const name of CONSUMERS) {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: `rr-test-${name}`,
        VisibilityTimeout: 270,
        RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
      });
      template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: `rr-test-${name}`, Timeout: 45, Runtime: 'nodejs22.x' });
    }
  });

  it('returns only failed messages to the queue', () => {
    template.allResourcesProperties('AWS::Lambda::EventSourceMapping', { FunctionResponseTypes: ['ReportBatchItemFailures'] });
  });

  it('sends what EventBridge cannot deliver to the dead-letter queue too', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['rr.booking'] },
      Targets: [Match.objectLike({ DeadLetterConfig: Match.anyValue() })],
    });
  });

  it('raises an alarm when the relay goes quiet, and every alarm reaches incident.io', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'rr-test-outbox-stuck', TreatMissingData: 'breaching' });
    template.allResourcesProperties('AWS::CloudWatch::Alarm', { AlarmActions: Match.anyValue() });
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'https', Endpoint: 'https://alerts.test/hook' });
  });

  it('keeps secrets out of the environment', () => {
    for (const f of Object.values(template.findResources('AWS::Lambda::Function'))) {
      const names = Object.keys(f.Properties.Environment?.Variables ?? {});
      expect(names.filter((n) => /URL|KEY|PASSWORD|DSN/.test(n) && n !== 'APP_URL')).toEqual([]);
    }
  });
});
