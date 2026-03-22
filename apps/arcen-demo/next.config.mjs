/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@meap/react", "@meap/core", "@meap/node"],
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "thread-stream",
    "lokijs",
    "encoding",
  ],
};

export default nextConfig;
