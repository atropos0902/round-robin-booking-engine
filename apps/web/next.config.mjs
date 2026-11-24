import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const release = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  // No image on the site needs resizing, and the optimizer is one more public endpoint to defend.
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_RELEASE: release },
  experimental: { instrumentationHook: true, outputFileTracingRoot: root },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Booking pages carry their token in the address.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
    ];
  },
};

export default withSentryConfig(config, {
  silent: true,
  telemetry: false,
  release: { name: release, create: Boolean(process.env.SENTRY_AUTH_TOKEN) },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
