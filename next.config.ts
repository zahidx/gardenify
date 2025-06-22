// next.config.js
/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // Optional: disable PWA in dev
});

const nextConfig = {
  // your other config here
};

module.exports = withPWA(nextConfig);
