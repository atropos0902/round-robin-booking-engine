import { ApiCheck, AssertionBuilder } from 'checkly/constructs';
import { alertChannels } from './alerts';

new ApiCheck('api-health', {
  name: 'API is up and the outbox is moving',
  frequency: 5,
  locations: ['eu-west-1', 'us-east-1', 'ap-southeast-2'],
  alertChannels,
  degradedResponseTime: 1500,
  maxResponseTime: 5000,
  request: {
    url: '{{API_URL}}/healthz',
    method: 'GET',
    assertions: [
      AssertionBuilder.statusCode().equals(200),
      AssertionBuilder.jsonBody('$.outbox.oldestSeconds').lessThan(300),
    ],
  },
});
