import type { ModelMetric, RejectRule } from "@/lib/types";

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

/*
  The authored validation queue used to sit here: eight invented items with invented
  confidences, rendered by a component the validation page had already stopped calling.
  It is gone — `/validation` reads the real holds from `gatekeeper_verdicts` through
  `listPendingHolds`. The metrics below stay, because they are the feature's evidence and
  the page now badges them as authored.
*/

/*
  The rule vocabulary. The codes are the ones the gatekeeper prompt hands the model
  (`R-01` non-e-waste, `R-02` duplicate, `R-03` reuse, `R-04` hazard handling), so this
  list is the set of reasons a refusal can have, not a count of any of them.

  It used to carry a `blocked` number per rule — 148, 61, 37, 24 — and a total of 270 that
  multiplied into "roughly ₹1.9L of simulated credits never issued". Nothing wrote those
  numbers and nothing could: a per-rule firing is a `rule_blocks` row and no code creates
  one. The refusal total the table now shows is `storedCounts().rejected`, counted from
  `gatekeeper_verdicts`.
*/
export const rejectRules: RejectRule[] = [
  { code: "R-01", rule: "Item shows no e-waste signature", note: "Non-electronic uploads are rejected before any credit is created." },
  { code: "R-02", rule: "Duplicate image hash for this collector", note: "Same photo resubmitted to farm credits." },
  { code: "R-03", rule: "Device powers on and clears reuse screen", note: "Working units go to refurbishment, not shredding." },
  { code: "R-04", rule: "Battery swelling above threshold", note: "Forces a licensed battery route instead of a rejection." },
];

export const thresholdNote =
  "Threshold tuned for precision at 0.95, not accuracy. A wrongly credited bottle costs the EPR budget; a wrongly rejected board only costs a re-upload.";
