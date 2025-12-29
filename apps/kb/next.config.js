/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@auxx/database', '@auxx/config'],
  output: 'standalone',
}
export default nextConfig
// module.exports = nextConfig
