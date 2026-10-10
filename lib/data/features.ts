import type { Feature, FeatureSlug } from "@/lib/types";

/**
 * The six capabilities, listed in workflow order so navigation reads as a
 * pipeline: identify a thing, price it, police it, move it, map the pressure,
 * then the channel that comes later.
 *
 * `productHref` is the working screen an operator uses, and `rank` is the
 * priority order — a different axis from build order.
 */
export const features: Feature[] = [
  {
    rank: 2,
    slug: "intake",
    productHref: "/intake",
    productName: "New intake",
    name: "Multi-modal identification",
    tagline:
      "A photo or a Hindi voice note in; item, brand and hazard class out.",
    pageJob:
      "Turn what a kabadiwala already has — a phone and a description — into structured item data.",
    status: "core",
    aws: ["Microsoft Foundry (multimodal: photo + audio)", "Server-side rate card"],
    proof:
      "The differentiator. Vernacular voice is what makes 1.5M informal collectors addressable, and no incumbent EPR tooling reads Hindi speech.",
  },
  {
    rank: 1,
    slug: "valuation",
    productHref: "/valuation",
    productName: "Valuations",
    name: "Metal & EPR valuation",
    tagline:
      "Assay the metals, price the scrap, mint the brand's EPR credit.",
    pageJob:
      "Return a defensible rupee figure the collector accepts and the brand can book.",
    status: "core",
    aws: ["Microsoft Foundry (multimodal)", "Server-side rate card"],
    proof:
      "This is the product. Every other capability exists to move a valued item through the pipeline, or to keep that valuation honest.",
  },
  {
    rank: 3,
    slug: "gatekeeper",
    productHref: "/validation",
    productName: "Validation queue",
    name: "Fraud-prevention gatekeeper",
    tagline:
      "Reject anything that is not e-waste before a rupee is promised.",
    pageJob:
      "Decide valid or invalid on every upload, and explain the decision.",
    status: "core",
    aws: ["Microsoft Foundry (vision)", "Reject rules R-01–R-04"],
    proof:
      "Credits are simulated, so the payout is gameable by definition. Precision, F1 and ROC-AUC are the evidence that it is not.",
  },
  {
    rank: 4,
    slug: "pickup",
    productHref: "/pickups",
    productName: "Pickups",
    name: "Smart pickup & digital credit",
    tagline:
      "Hazardous loads go to authorised recyclers; the collector gets a credit note.",
    pageJob:
      "Route the item, then hand the collector a receipt they can hold.",
    status: "core",
    aws: ["API Gateway", "Lambda", "DynamoDB"],
    proof:
      "Supplies the word verifiable in verifiable EPR compliance — an auditable chain from doorstep to licensed recycler.",
  },
  {
    rank: 5,
    slug: "heatmap",
    productHref: "/map",
    productName: "Hotspot map",
    name: "Spatial heatmapping",
    tagline:
      "Cluster geotagged pickups into ward-level dumping hotspots.",
    pageJob:
      "Tell a ward officer where the next collection van should stand.",
    status: "supporting",
    aws: ["OpenSearch (run locally)", "DynamoDB", "Next.js"],
    proof:
      "Strong municipal pitch and a good visual, but it serves a second customer and sits downstream of the core loop.",
  },
  {
    rank: 6,
    slug: "roadmap",
    // Deliberately no product screen: this capability is deferred by choice.
    productHref: null,
    productName: null,
    name: "WhatsApp intake",
    tagline: "The same pipeline on the channel collectors already use.",
    pageJob:
      "State plainly what ships, what follows, and what is deliberately not built today.",
    status: "deferred",
    aws: ["Outside the AWS stack (WhatsApp Business API)"],
    proof:
      "Lowest. A channel, not a capability: it re-transports voice intake, adds webhook and business-account approval risk, and proves no new intelligence on stage.",
  },
];

/** Highest priority first — the doc index ladder. */
export const featuresByRank: Feature[] = [...features].sort(
  (a, b) => a.rank - b.rank,
);

export function getFeature(slug: FeatureSlug): Feature {
  const feature = features.find((entry) => entry.slug === slug);
  if (!feature) {
    throw new Error(`No feature registered for slug ${slug}`);
  }
  return feature;
}

/** The core loop: the capabilities an item actually travels through. */
export const coreLoopSlugs: FeatureSlug[] = [
  "intake",
  "valuation",
  "gatekeeper",
  "pickup",
];
