import type { MetadataRoute } from "next";
import {
  DASHBOARD_DESCRIPTION,
  DASHBOARD_SITE_NAME,
} from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: DASHBOARD_SITE_NAME,
    short_name: "ArcenPay",
    description: DASHBOARD_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [
      {
        src: "/icon-light-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
  };
}
