/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        // Without a trailing slash the pattern below does not match, and the
        // iframe's own src ("/iframe/") redirects here first.
        source: '/iframe',
        destination: 'http://localhost:5188/iframe/',
      },
      {
        source: '/iframe/:path*',
        // Keep the /iframe prefix: the Vite app is served under that base so
        // its own asset URLs resolve through this same rewrite.
        destination: 'http://localhost:5188/iframe/:path*',
      },
    ]
  },
}

module.exports = nextConfig
