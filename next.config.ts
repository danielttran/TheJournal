import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@journeyapps/sqlcipher', 'argon2'],
  devIndicators: false,
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
