import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks cross-origin requests to the dev server by default —
  // only `localhost` is allowed unless explicitly listed here. Needed to
  // test on a phone/other device over the LAN during development; has no
  // effect on a production build/deploy (`next build`/`next start`),
  // where this restriction doesn't apply at all.
  allowedDevOrigins: ["192.168.254.104"],
  // Server Actions default to a 1MB request body — the Import Bill of
  // Materials modal (extractBomFromFile, lib/bom-import/actions.ts)
  // uploads the raw PDF/photo straight through a Server Action call, so
  // anything past a tiny file trips that default. Set comfortably above
  // that action's own MAX_FILE_BYTES (15mb) to leave room for
  // multipart/form-data's own boundary/header overhead — see this
  // option's own doc comment in node_modules/next/dist/docs for why that
  // overhead matters right at the edge of the limit.
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
