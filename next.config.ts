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
  // Next.js's file tracer doesn't always follow into native module subdirs
  // (the .node binaries don't live in JavaScript require() graphs). Force
  // them into the standalone tree so `node server.js` can dlopen them.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@journeyapps/sqlcipher/lib/binding/**/*',
      './node_modules/argon2/prebuilds/**/*',
      './node_modules/argon2/lib/**/*',
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
