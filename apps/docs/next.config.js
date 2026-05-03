/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Signal",
            value: "ai-train=yes, search=yes, ai-input=yes",
          },
          {
            key: "X-Robots-Tag",
            value: "index, follow, ai-train, ai-input",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
