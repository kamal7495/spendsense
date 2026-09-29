/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse (via pdfjs-dist) and tesseract.js assume they're loaded through
  // Node's native require, not webpack's RSC bundler — bundling them breaks
  // pdfjs-dist's internal module setup. Load them as real Node modules instead.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist", "tesseract.js"],
  },
};

export default nextConfig;
