/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-side proxy to the agent's read-only API — avoids CORS entirely.
  // Point AGENT_API_URL elsewhere when the agent runs on a VPS (via SSH tunnel).
  async rewrites() {
    const target = process.env.AGENT_API_URL ?? 'http://localhost:3001';
    return [{ source: '/agent/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
