import path from 'node:path';
import type { NextConfig } from 'next';

// `standalone` se activa SOLO al construir en Docker/Linux. En Windows los
// symlinks del standalone rompen el build, así que el modo normal no lo usa.
const standalone = process.env.NEXT_STANDALONE === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: 'standalone' as const, outputFileTracingRoot: path.join(process.cwd(), '..', '..') } : {}),
  // NOTA: `output: 'standalone'` se habilita en el despliegue Docker/Linux;
  // en Windows los symlinks del standalone rompen el build.
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
