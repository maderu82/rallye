import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Proof photos are uploaded through a Server Action; raise the body limit.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
