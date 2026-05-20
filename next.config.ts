import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  serverExternalPackages: ['@journeyapps/sqlcipher', 'argon2'],
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
