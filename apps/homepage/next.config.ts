import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@auxx/config'],
  images: {
    // Avoid requiring sharp in the server Lambda; rely on client-side <img> or our optimizer function
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '7xysn5pd7c.ufs.sh', pathname: '/f/*' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'auxxai-files.s3.us-east-2.amazonaws.com', pathname: '/**' },
      { protocol: 'https', hostname: 'ui-avatars.com', pathname: '/**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  /* config options here */
}

export default nextConfig
