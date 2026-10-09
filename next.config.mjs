import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

// Staging retains dependency links to previous source trees. Turbopack's root
// must contain both the app and the real dependency directory, not just cwd.
export function commonBuildRoot(appRoot, dependencyRoot) {
  let root = appRoot;
  for (;;) {
    if (dirname(root) === root) {
      throw new Error("Application dependencies must share a non-filesystem build root");
    }
    const child = relative(root, dependencyRoot);
    if (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) return root;
    const parent = dirname(root);
    if (parent === root) throw new Error("Cannot contain application dependencies in a build root");
    root = parent;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // An owned build must not inherit an ancestor lockfile's workspace root.
  turbopack: { root: commonBuildRoot(
    realpathSync(process.cwd()), realpathSync(join(process.cwd(), "node_modules")),
  ) },
  // Allow the Replit dev proxy origin to access _next/* resources without
  // triggering cross-origin warnings that can interfere with cookie delivery.
  allowedDevOrigins: [
    "*.riker.replit.dev",
    "*.replit.dev",
    "127.0.0.1",
    "localhost",
  ],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: '**.storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      // Replit Object Storage — served through our /api/public-objects proxy
      {
        protocol: 'https',
        hostname: '**.riker.replit.dev',
      },
    ],
  },
  serverExternalPackages: [
    '@ffprobe-installer/ffprobe',
    'ffmpeg-static',
    'fluent-ffmpeg',
    'pg-boss',
    'sharp',
  ],
};

export default nextConfig;
