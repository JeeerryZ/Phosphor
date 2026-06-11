import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows the Next.js dev server to accept requests proxied through the
  // ngrok tunnel used for the Bungie OAuth redirect.
  allowedDevOrigins: ["evenly-deep-terrapin.ngrok-free.app"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.bungie.net",
      },
    ],
  },
};

export default nextConfig;
