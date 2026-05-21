import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  // Standalone output produces a minimal .next/standalone/ directory containing
  // server.js + the traced node_modules. `node .next/standalone/server.js`
  // runs the production web server with no `next` CLI involved. Electron's
  // main.js still uses next() programmatically — that code path is unaffected
  // because the embedded server is constructed at runtime, not from the
  // standalone output.
  output: 'standalone',
  serverExternalPackages: ['@journeyapps/sqlcipher', 'argon2'],
  // Next.js 16's standalone output greedily copies the entire project
  // root into .next/standalone/ — including live DB files, dev .tjdb,
  // tests/, screenshots, etc. Anything that isn't required at runtime
  // is excluded explicitly here to keep the bundle small AND to prevent
  // local data from accidentally shipping to production.
  outputFileTracingExcludes: {
    '*': [
      // Local development data — must never ship.
      './journal.db',
      './journal.db.bak',
      './journal.tjdb',
      './journal.tjdb-shm',
      './journal.tjdb-wal',
      // Source / tooling not needed at runtime.
      './src/**/*',
      './tests/**/*',
      './scripts/**/*',
      './screenshot/**/*',
      './docs/**/*',
      './deploy/**/*',
      './dist/**/*',
      './.github/**/*',
      './tsconfig.json',
      './tsconfig.tsbuildinfo',
      './eslint.config.mjs',
      './postcss.config.mjs',
      './electron-builder.yml',
      './next.config.ts',
      './package-lock.json',
      './vitest.config.ts',
    ],
  },
  experimental: {
    serverActions: {
      // M5: large media (video, audio, drawings) — match DavidRM's 225MB ceiling.
      bodySizeLimit: '250mb',
    },
  },
  images: {
    unoptimized: true,
  }
};

export default nextConfig;
