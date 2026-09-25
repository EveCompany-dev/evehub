import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// One .env at the repo root feeds web, worker and the Prisma CLI alike.
// Next only looks inside the app directory, so point it upwards explicitly.
loadEnv({ path: ['.env', '../../.env'], quiet: true });

/**
 * Sent on every response. The CSP covers only what is safe without nonces:
 * who may frame the app, <base> and plugins. A script-src policy needs a nonce
 * on every inline script Next emits, which is its own piece of work.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Browsers ignore HSTS over plain http, so this is inert in local dev.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // An internal tool: nothing here belongs in a search index (see also app/robots.ts).
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Next 16 bloqueia /_next/* vindo de outra origem em modo dev. Sem isto, abrir
  // pelo IP da rede (celular, outro PC) carrega o HTML mas nao o JavaScript:
  // a tela aparece e nada funciona, inclusive o login.
  allowedDevOrigins: ['192.168.2.9', '192.168.*.*', '100.*.*.*'],
  // Workspace packages ship TypeScript source rather than a build artifact,
  // so Next compiles them as part of the app. No build step to keep in sync.
  transpilePackages: ['@eve/core', '@eve/ui', '@eve/connector-sdk', '@eve/connector-demo'],
  // Keeps the native argon2 binding, the pg driver and ioredis out of the bundler.
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'ioredis', '@prisma/adapter-pg'],
};

export default nextConfig;
