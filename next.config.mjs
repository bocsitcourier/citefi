/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the Replit dev proxy origin to access _next/* resources without
  // triggering cross-origin warnings that can interfere with cookie delivery.
  allowedDevOrigins: ["*.riker.replit.dev", "*.replit.dev"],
  typescript: {
    ignoreBuildErrors: true,
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
