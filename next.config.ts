import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

// Pin the package version into the build so /api/health can surface it
// even when launched via `node .next/standalone/server.js` (where
// npm_package_version isn't set because npm isn't invoking the process).
const pkgVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  env: {
    // Read by /api/health/route.ts via process.env. NEXT_PUBLIC_ prefix is
    // a Next.js convention that inlines the value at build time. Health
    // is a server-only endpoint so technically the prefix isn't required,
    // but using NEXT_PUBLIC_ keeps the var accessible in any future
    // client-side "About" UI that wants to render the version.
    NEXT_PUBLIC_APP_VERSION: pkgVersion,
  },
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
    '/*': [
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
  },
  // Baseline security headers on every response. Deliberately conservative —
  // no global CSP (Next.js needs inline/runtime scripts; a strict policy here
  // would break hydration). nosniff + frame/referrer hardening are safe
  // app-wide; untrusted blob serving gets a strict CSP on its own route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
