import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets phones on the same Wi-Fi load dev resources (HMR, chunks); dev-only.
  allowedDevOrigins: ["10.12.51.123"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
