import type { ProductHref } from "@/lib/types";

/**
 * Navigation for the working product, grouped by the job it serves rather than
 * by the capability behind it. The doc section has its own rail.
 */
export interface ProductNavItem {
  label: string;
  href: ProductHref;
  /** What the operator does here, used as the link's accessible description. */
  hint: string;
}

export interface ProductNavGroup {
  label: string;
  items: ProductNavItem[];
}

export const productNav: ProductNavGroup[] = [
  {
    label: "Operations",
    items: [
      { label: "Dashboard", href: "/dashboard", hint: "Today across the pilot" },
      { label: "New intake", href: "/intake", hint: "Capture an item from a photo or voice note" },
      { label: "Valuations", href: "/valuation", hint: "Price an item and issue the EPR credit" },
      { label: "Validation queue", href: "/validation", hint: "Clear items the model could not settle" },
      { label: "Pickups", href: "/pickups", hint: "Route loads and settle credit notes" },
      { label: "Collector handoff", href: "/handoff", hint: "The collector's phone: route a load and show the PIN" },
      { label: "Recycler gate", href: "/gate", hint: "Weigh the load, enter the PIN, issue the credit" },
      { label: "Handoff demo", href: "/demo", hint: "Phone and gate side by side" },
      { label: "Evidence", href: "/evidence", hint: "The archived photo or voice note behind a submission" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Hotspot map", href: "/map", hint: "Ward-level dumping pressure" },
      { label: "Collectors", href: "/collectors", hint: "The collectors on the platform" },
      { label: "Recyclers", href: "/recyclers", hint: "CPCB-registered destinations" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Team", href: "/team", hint: "Everyone with an account, and when they were last seen" },
      { label: "Rate card", href: "/rates", hint: "The material prices every valuation uses" },
    ],
  },
];
