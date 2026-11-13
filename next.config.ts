import type { NextConfig } from "next";

// Every screen renders live, per-persona data from SQLite, so the app uses
// fully dynamic rendering. Cache Components / Partial Prefetching (the
// create-next-app defaults) are intentionally left off: there is nothing
// static worth prerendering and stale booking state would be a correctness bug.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
