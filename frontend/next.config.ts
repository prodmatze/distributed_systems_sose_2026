import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder so Turbopack only watches `frontend/`
  // and never crawls the repo root (Python venv, .git, etc.).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
