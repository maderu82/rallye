import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are used for grading and designer mutations.
  },
};

export default nextConfig;
