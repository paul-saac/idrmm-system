import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to the dev server by default —
  // only `localhost` is allowed unless explicitly listed here. Needed to
  // test on a phone/other device over the LAN during development; has no
  // effect on a production build/deploy (`next build`/`next start`),
  // where this restriction doesn't apply at all.
  allowedDevOrigins: ["192.168.254.104"],
};

export default nextConfig;
