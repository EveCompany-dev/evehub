import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// One .env at the repo root feeds web, worker and the Prisma CLI alike.
// Next only looks inside the app directory, so point it upwards explicitly.
loadEnv({ path: ['.env', '../../.env'], quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 bloqueia /_next/* vindo de outra origem em modo dev. Sem isto, abrir
  // pelo IP da rede (celular, outro PC) carrega o HTML mas nao o JavaScript:
  // a tela aparece e nada funciona, inclusive o login.
  allowedDevOrigins: ['192.168.2.9', '192.168.*.*', '100.*.*.*'],
  // Workspace packages ship TypeScript source rather than a build artifact,
  // so Next compiles them as part of the app. No build step to keep in sync.
  transpilePackages: ['@eve/core', '@eve/ui', '@eve/connector-sdk', '@eve/connector-demo'],
  experimental: {
    // Keeps the native argon2 binding and the pg driver out of the bundler.
    serverActions: { bodySizeLimit: '1mb' },
  },
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'ioredis', '@prisma/adapter-pg'],
};

export default nextConfig;
