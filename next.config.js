/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./.knowledge_store/**/*'],
  },
};

export default nextConfig;
