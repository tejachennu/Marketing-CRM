/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  // The PDF and Word readers for the AI knowledge base run from node_modules as they are (tested that way)
  serverExternalPackages: ['unpdf', 'mammoth'],
}

export default nextConfig
