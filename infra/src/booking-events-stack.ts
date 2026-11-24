import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

const ROOT = path.resolve(__dirname, '../..');
const ENGINE = 'libquery_engine-rhel-openssl-3.0.x.so.node';

/** The same names the workers use. The queue names are prefix + name, prefix + name + -dlq. */
export const CONSUMERS = ['calendar-sync', 'email', 'webhooks'] as const;

export interface BookingEventsProps extends StackProps {
  readonly stage: string;
  readonly appUrl: string;
  readonly release: string;
  /** Where incident.io takes CloudWatch alarms. Without it the alarms exist but tell nobody. */
  readonly incidentUrl?: string;
}

export class BookingEventsStack extends Stack {
  constructor(scope: Construct, id: string, props: BookingEventsProps) {
    super(scope, id, props);
    const prefix = `rr-${props.stage}-`;

    const secret = secrets.Secret.fromSecretNameV2(this, 'AppSecret', `rr/${props.stage}/app`);
    const bus = new events.EventBus(this, 'Bus', { eventBusName: `${prefix}booking` });
    const alarms = new sns.Topic(this, 'Alarms', { topicName: `${prefix}alarms` });
    if (props.incidentUrl) alarms.addSubscription(new UrlSubscription(props.incidentUrl));

    const fn = (name: string, entry: string, timeout: Duration, environment: Record<string, string>, concurrency?: number) => {
      const created = new NodejsFunction(this, name, {
        functionName: `${prefix}${name}`,
        entry: path.join(ROOT, 'apps/workers/src/lambda', entry),
        projectRoot: ROOT,
        depsLockFilePath: path.join(ROOT, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.X86_64,
        memorySize: 512,
        timeout,
        reservedConcurrentExecutions: concurrency,
        logGroup: new logs.LogGroup(this, `${name}-logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          APP_SECRET_ID: secret.secretName,
          APP_ENV: props.stage,
          APP_RELEASE: props.release,
          APP_URL: props.appUrl,
          SERVICE_NAME: `rr-${name}`,
          ...environment,
        },
        bundling: {
          sourceMap: true,
          // Prisma looks for its engine and schema next to the bundle.
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (input, output) => [
              `cp ${input}/node_modules/.prisma/client/${ENGINE} ${output}`,
              `cp ${input}/packages/core/prisma/schema.prisma ${output}`,
            ],
          },
        },
      });
      secret.grantRead(created);
      return created;
    };

    for (const name of CONSUMERS) {
      const dlq = new sqs.Queue(this, `${name}-dlq`, {
        queueName: `${prefix}${name}-dlq`,
        retentionPeriod: Duration.days(14),
        enforceSSL: true,
      });
      const timeout = Duration.seconds(45);
      const queue = new sqs.Queue(this, `${name}-queue`, {
        queueName: `${prefix}${name}`,
        // Six times the function timeout, so a message is not handed out again while it is being handled.
        visibilityTimeout: Duration.seconds(6 * 45),
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
        enforceSSL: true,
      });
      new events.Rule(this, `${name}-rule`, {
        eventBus: bus,
        eventPattern: { source: ['rr.booking'], detailType: ['booking.confirmed', 'booking.cancelled'] },
        targets: [new targets.SqsQueue(queue, { deadLetterQueue: dlq, retryAttempts: 20, maxEventAge: Duration.hours(6) })],
      });
      const consumer = fn(name, 'consumer.ts', timeout, { CONSUMER: name });
      consumer.addEventSource(new SqsEventSource(queue, { batchSize: 5, reportBatchItemFailures: true, maxConcurrency: 5 }));
      if (name === 'email') {
        consumer.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: [this.formatArn({ service: 'ses', resource: 'identity', resourceName: '*' })],
          }),
        );
      }

      new cloudwatch.Alarm(this, `${name}-dead-letters`, {
        alarmName: `${prefix}${name}-dead-letters`,
        alarmDescription: `Messages in ${prefix}${name}-dlq. Runbook: docs/runbooks/dead-letters.md`,
        metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(alarms));
    }

    const relay = fn('relay', 'relay.ts', Duration.seconds(60), { EVENT_BUS_NAME: bus.eventBusName });
    bus.grantPutEventsTo(relay);
    new events.Rule(this, 'RelayEveryMinute', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(relay, { retryAttempts: 0 })],
    });

    const age = new logs.MetricFilter(this, 'OutboxAge', {
      logGroup: relay.logGroup,
      metricNamespace: 'RoundRobin',
      metricName: `${prefix}outbox-age`,
      filterPattern: logs.FilterPattern.exists('$.outboxAge'),
      metricValue: '$.outboxAge',
    });
    new cloudwatch.Alarm(this, 'outbox-stuck', {
      alarmName: `${prefix}outbox-stuck`,
      alarmDescription: 'Events wait in the outbox, or the relay is not running. Runbook: docs/runbooks/outbox-stuck.md',
      metric: age.metric({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 300,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      // A relay that stopped reports nothing, and that is the worse case.
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(new SnsAction(alarms));

    new CfnOutput(this, 'BusName', { value: bus.eventBusName });
  }
}
