/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
