// Next.js configuration — environment variables, image domains, and Vercel deployment settings
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
