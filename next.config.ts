import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,   // StrictMode double-invokes effects in dev — disable for cleaner logs
  serverExternalPackages: ['@journeyapps/sqlcipher', 'argon2'],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  images: {
    unoptimized: true,
  }
};

export default nextConfig;
