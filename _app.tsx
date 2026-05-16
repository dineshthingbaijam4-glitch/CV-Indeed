/** @type {import('next').NextConfig} */
const nextConfig = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
}
module.exports = nextConfig
