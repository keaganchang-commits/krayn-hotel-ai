/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'vectra'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./.knowledge_store/**/*'],
  },
};

export default nextConfig;
