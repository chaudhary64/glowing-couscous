import type { ModelMetric, RejectRule, ValidationRecord } from "@/lib/types";

/**
 * Gatekeeper evidence. These numbers are the argument for the feature: credits
 * are simulated, so the only thing standing between the payout and a plastic
 * bottle is this classifier and its thresholds.
 */
export const modelMetrics: ModelMetric[] = [
  {
    label: "Precision",
    value: 0.94,
    target: 0.9,
    unit: "raw",
    note: "Of the items we credit, 94% are genuine e-waste.",
  },
  {
    label: "Recall",
    value: 0.87,
    target: 0.85,
    unit: "raw",
    note: "Of genuine e-waste offered, 87% clears. Misses are re-uploaded, not lost.",
  },
  {
    label: "F1",
    value: 0.9,
    target: 0.88,
    unit: "raw",
    note: "Balance point between the two — the number we tune against.",
  },
  {
    label: "ROC-AUC",
    value: 0.96,
    target: 0.93,
    unit: "raw",
    note: "Threshold separates fraud from genuine scrap across the whole range.",
  },
  {
    label: "False-credit rate",
    value: 0.06,
    target: 0.05,
    unit: "raw",
    note: "The one metric missing target. Precision must reach 0.95 before credits go live.",
  },
];

export const metricHoldout = {
  labelled: 1840,
  positives: 1312,
  negatives: 528,
  reviewedBy: "two reviewers, CPCB category sheet v4",
  lastTrained: "06 Oct 2026",
};

export const validationQueue: ValidationRecord[] = [
  { id: "ECO-2026-0436", subject: "PET bottle", collector: "Imran Sheikh", submittedAt: "14:44", verdict: "rejected", confidence: 0.99, reason: "No circuit, metal or cell signature." },
  { id: "ECO-2026-0435", subject: "Redmi Note 12", collector: "Imran Sheikh", submittedAt: "14:40", verdict: "rejected", confidence: 0.86, reason: "Powers on — routed to reuse under R-03." },
  { id: "ECO-2026-0431", subject: "Dell laptop mainboard", collector: "Sunita Pawar", submittedAt: "14:22", verdict: "verified", confidence: 0.97, reason: "PCB assembly confirmed, lead solder flagged." },
  { id: "ECO-2026-0432", subject: "Samsung battery pack", collector: "Sunita Pawar", submittedAt: "14:26", verdict: "verified", confidence: 0.93, reason: "Li-ion pack, swollen — hazard route forced." },
  { id: "ECO-2026-0434", subject: "HP printer power supply", collector: "Rakesh Yadav", submittedAt: "14:35", verdict: "verified", confidence: 0.91, reason: "Copper yield consistent with declared mass." },
  { id: "ECO-2026-0433", subject: 'LG 21" CRT monitor', collector: "Rakesh Yadav", submittedAt: "14:31", verdict: "review", confidence: 0.68, reason: "Weight class exceeds doorstep threshold." },
  { id: "eco-2026-0430", subject: "Microwave (door missing)", collector: "Anita Kamble", submittedAt: "13:58", verdict: "review", confidence: 0.72, reason: "Large appliance, magnetron handling unclear." },
  { id: "eco-2026-0429", subject: "PCB scrap, loose", collector: "Anita Kamble", submittedAt: "13:41", verdict: "verified", confidence: 0.95, reason: "Loose boards, mass estimated from image scale." },
];

export const rejectRules: RejectRule[] = [
  { code: "R-01", rule: "Item shows no e-waste signature", blocked: 148, note: "Non-electronic uploads blocked before any credit is created." },
  { code: "R-02", rule: "Duplicate image hash for this collector", blocked: 61, note: "Same photo resubmitted to farm credits." },
  { code: "R-03", rule: "Device powers on and clears reuse screen", blocked: 37, note: "Working units go to refurbishment, not shredding." },
  { code: "R-04", rule: "Battery swelling above threshold", blocked: 24, note: "Forces a licensed battery route instead of a rejection." },
];

/** Median payout per credited item, used only to size what the reject rules stop. */
export const medianPayoutInr = 700;

/** Uploads stopped by these rules in the review period. */
export const blockedTotal = rejectRules.reduce(
  (total, rule) => total + rule.blocked,
  0,
);

/** What those blocked uploads would have drawn in simulated credits. */
export const preventedCreditsInr = blockedTotal * medianPayoutInr;

export const thresholdNote =
  "Threshold tuned for precision at 0.95, not accuracy. A wrongly credited bottle costs the EPR budget; a wrongly rejected board only costs a re-upload.";
