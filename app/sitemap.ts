import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

const FEATURES = ["intake", "valuation", "gatekeeper", "pickup", "heatmap", "roadmap"];

/** The public pages only: the product's screens redirect a crawler to the sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", "/doc", ...FEATURES.map((feature) => `/doc/features/${feature}`)];
  return pages.map((path) => ({ url: new URL(path, SITE_URL).href }));
}
