import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows the Next.js dev server to accept requests proxied through the
  // ngrok tunnel used for the Bungie OAuth redirect.
  allowedDevOrigins: ["evenly-deep-terrapin.ngrok-free.app"],
  // piscina resolves its worker.js entry via `path.resolve(__dirname, "worker.js")` at runtime.
  // Bundling it makes Turbopack/webpack rewrite `__dirname` to a virtual path that doesn't exist
  // on disk, breaking that lookup - keep it as a real require() from node_modules instead.
  serverExternalPackages: ["piscina", "better-sqlite3"],
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
