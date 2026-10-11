import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/** The landing page and the write-ups are public; everything else needs a sign-in. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}
