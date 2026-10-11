import type {
  ActivityKind,
  Collector,
  FeatureStatus,
  ItemCondition,
  MaterialCategory,
  PickupStatus,
  Verdict,
} from "@/lib/types";

/**
 * The single vocabulary for state. Every screen maps state through these
 * functions, so "verified" is green in exactly one shade wherever it appears and
 * a label never drifts between screens.
 */

export type BadgeTone =
  | "neutral"
  | "ink"
  | "copper"
  | "verified"
  | "hazard"
  | "review"
  | "lead";

export function verdictTone(verdict: Verdict): BadgeTone {
  if (verdict === "verified") return "verified";
  if (verdict === "rejected") return "hazard";
  return "review";
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === "verified") return "Verified";
  if (verdict === "rejected") return "Rejected";
  return "Review";
}

/** Precious metals take the copper accent; inert material stays grey. */
export function materialTone(category: MaterialCategory): BadgeTone {
  if (category === "precious") return "copper";
  if (category === "hazardous") return "hazard";
  if (category === "base") return "lead";
  return "neutral";
}

export function materialLabel(category: MaterialCategory): string {
  if (category === "precious") return "Precious";
  if (category === "hazardous") return "Hazardous";
  if (category === "base") return "Base metal";
  return "Inert";
}

export function pickupTone(status: PickupStatus): BadgeTone {
  if (status === "settled") return "verified";
  if (status === "received") return "ink";
  if (status === "in-transit") return "copper";
  if (status === "assigned") return "review";
  return "neutral";
}

export function pickupLabel(status: PickupStatus): string {
  if (status === "settled") return "Settled";
  if (status === "received") return "Received";
  if (status === "in-transit") return "In transit";
  if (status === "assigned") return "Assigned";
  return "Requested";
}

export function conditionTone(condition: ItemCondition): BadgeTone {
  if (condition === "working") return "copper";
  if (condition === "damaged") return "hazard";
  return "lead";
}

export function featureStatusTone(status: FeatureStatus): BadgeTone {
  if (status === "core") return "copper";
  if (status === "supporting") return "lead";
  return "review";
}

/**
 * Collector standing is platform history rather than a verdict, so the accent
 * goes to the most senior tier: if every tier were grey the ladder would be
 * unreadable, and if all three were accented none of them would stand out.
 */
export function collectorTierTone(tier: Collector["tier"]): BadgeTone {
  if (tier === "lead") return "copper";
  if (tier === "verified") return "lead";
  return "neutral";
}

export function collectorTierLabel(tier: Collector["tier"]): string {
  if (tier === "lead") return "Lead";
  if (tier === "verified") return "Verified";
  return "New";
}

/** Event kinds in the operator activity feed. */
export function activityTone(kind: ActivityKind): BadgeTone {
  if (kind === "settled") return "verified";
  if (kind === "validation") return "review";
  if (kind === "pickup") return "copper";
  return "lead";
}

export function activityLabel(kind: ActivityKind): string {
  if (kind === "settled") return "Settled";
  if (kind === "validation") return "Gatekeeper";
  if (kind === "pickup") return "Pickup";
  if (kind === "valuation") return "Valuation";
  return "Intake";
}

/** Hotspot cluster states used by the map and its tables. */
export function hotspotStatusTone(
  status: "open" | "van-assigned" | "cleared",
): BadgeTone {
  if (status === "open") return "hazard";
  if (status === "van-assigned") return "copper";
  return "verified";
}

export function hotspotStatusLabel(
  status: "open" | "van-assigned" | "cleared",
): string {
  if (status === "open") return "Open";
  if (status === "van-assigned") return "Van assigned";
  return "Cleared";
}
