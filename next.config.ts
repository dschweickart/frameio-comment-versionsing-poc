import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.frame.io',
      },
      {
        protocol: 'https',
        hostname: '**.adobe.com',
      },
    ],
  },
};

export default nextConfig;
