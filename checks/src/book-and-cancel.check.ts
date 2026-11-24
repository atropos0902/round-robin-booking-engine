import * as path from 'node:path';
import { BrowserCheck } from 'checkly/constructs';
import { alertChannels } from './alerts';

new BrowserCheck('book-and-cancel', {
  name: 'A customer can book a slot and cancel it',
  frequency: 10,
  locations: ['eu-west-1', 'us-east-1', 'ap-southeast-2'],
  alertChannels,
  tags: ['release'],
  code: { entrypoint: path.join(__dirname, 'book-and-cancel.spec.ts') },
});
