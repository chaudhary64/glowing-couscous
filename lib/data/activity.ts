import type { ActivityKind, ProductHref } from "@/lib/types";

/**
 * What an operator sees on the dashboard: the work that is waiting, and what
 * happened today. Hardcoded, but shaped like a real event stream so the wiring
 * to DynamoDB streams later is a substitution rather than a rewrite.
 */

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  subject: string;
  detail: string;
  actor: string;
  href: ProductHref;
}

export const activityFeed: ActivityEvent[] = [
  {
    id: "EV-9012",
    at: "15:20",
    kind: "settled",
    subject: "CN-2026-8838 settled",
    detail: "HP printer power supply · ₹106 paid to Rakesh Yadav",
    actor: "Sahyadri Metals (Pune)",
    href: "/pickups",
  },
  {
    id: "EV-9011",
    at: "15:02",
    kind: "pickup",
    subject: "PU-8841 collected",
    detail: "Dell laptop mainboard · hazard declaration attached",
    actor: "EcoRecycle Mumbai",
    href: "/pickups",
  },
  {
    id: "EV-9010",
    at: "14:44",
    kind: "validation",
    subject: "ECO-2026-0436 rejected",
    detail: "PET bottle · no circuit, metal or cell signature",
    actor: "eco-gate v0.4",
    href: "/validation",
  },
  {
    id: "EV-9009",
    at: "14:40",
    kind: "validation",
    subject: "ECO-2026-0435 rejected",
    detail: "Redmi Note 12 powers on · rerouted to reuse under R-03",
    actor: "eco-gate v0.4",
    href: "/validation",
  },
  {
    id: "EV-9008",
    at: "14:35",
    kind: "valuation",
    subject: "ECO-2026-0434 priced",
    detail: "Printer power supply · ₹226 gross, ₹106 net, 320 g copper",
    actor: "Microsoft Foundry",
    href: "/valuation",
  },
  {
    id: "EV-9007",
    at: "14:31",
    kind: "validation",
    subject: "ECO-2026-0433 held for review",
    detail: "CRT monitor · weight class exceeds doorstep threshold",
    actor: "eco-gate v0.4",
    href: "/validation",
  },
  {
    id: "EV-9006",
    at: "14:26",
    kind: "intake",
    subject: "SMP-002 captured",
    detail: "Photo intake · swollen Li-ion pack, Swelling model 0.88",
    actor: "Sunita Pawar",
    href: "/intake",
  },
  {
    id: "EV-9005",
    at: "14:22",
    kind: "intake",
    subject: "SMP-001 captured",
    detail: "Hindi voice note · 11 s · resolved to a laptop mainboard",
    actor: "Sunita Pawar",
    href: "/intake",
  },
  {
    id: "EV-9004",
    at: "13:58",
    kind: "validation",
    subject: "eco-2026-0430 held for review",
    detail: "Microwave with a missing door · magnetron handling unclear",
    actor: "eco-gate v0.4",
    href: "/validation",
  },
  {
    id: "EV-9003",
    at: "11:05",
    kind: "settled",
    subject: "CN-2026-8845 settled",
    detail: "Samsung battery pack · ₹42 paid to Devendra Solanki",
    actor: "GreenLoop Battery Line",
    href: "/pickups",
  },
];

export interface AttentionItem {
  id: string;
  label: string;
  count: number;
  detail: string;
  href: ProductHref;
  tone: "hazard" | "review" | "copper" | "lead";
}

/** The work queue, ordered the way an operator would work it. */
export const needsAttention: AttentionItem[] = [
  {
    id: "queue-validation",
    label: "Items awaiting a human decision",
    count: 2,
    detail:
      "A CRT monitor and a microwave are held: the model would not settle either one alone.",
    href: "/validation",
    tone: "review",
  },
  {
    id: "queue-hotspots",
    label: "Hotspots with no van assigned",
    count: 2,
    detail:
      "Kurla scrap lane and Andheri back plots. Both crossed four detections this week.",
    href: "/map",
    tone: "hazard",
  },
  {
    id: "queue-pickups",
    label: "Loads moving right now",
    count: 2,
    detail:
      "One in transit to EcoRecycle Mumbai, one battery run assigned to GreenLoop.",
    href: "/pickups",
    tone: "copper",
  },
  {
    id: "queue-notes",
    label: "Credit notes issued today",
    count: 2,
    detail: "₹148 settled to collectors. Every note is tied to a weighed load.",
    href: "/pickups",
    tone: "lead",
  },
];

export const activityMeta = {
  window: "Today, 09 Oct 2026",
  events: activityFeed.length,
  capturedBy: "Intake, valuation, gatekeeper and pickup events",
};
