import { defineConfig } from 'checkly';
import { Frequency } from 'checkly/constructs';

export default defineConfig({
  projectName: 'Round-robin booking engine',
  logicalId: 'round-robin-booking-engine',
  checks: {
    activated: true,
    frequency: Frequency.EVERY_10M,
    checkMatch: 'src/**/*.check.ts',
    browserChecks: { testMatch: [] },
  },
  cli: { runLocation: 'eu-west-1' },
});
