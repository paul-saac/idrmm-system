import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "IDR M&M", short_name: "IDRMM", description: "Construction project management and offline daily accomplishments",
    start_url: "/offline/index.html", scope: "/", display: "standalone", background_color: "#f7f7f8", theme_color: "#3b3939",
    icons: [{ src: "/offline/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] };
}
