/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
};

// The Android app packages the static `out` folder. Vercel sets VERCEL=1 and
// must keep the Node server so /api/ai is actually deployed.
if (process.env.VERCEL !== '1') {
  nextConfig.output = 'export';
}

module.exports = nextConfig;
