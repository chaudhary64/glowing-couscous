/**
 * The load the handoff screens are demonstrated on.
 *
 * Two inverter batteries — sealed lead-acid, 37.5 kg — collected by Sunita Pawar
 * (C-1042) in Mumbai. Chosen because it shows both halves of the feature at once:
 *
 *   - lead-acid is a **hazardous** stream, so the router must pass over the nearest
 *     site (RX-01, Mumbai, not licensed for it) and send it to RX-02 GreenLoop Battery
 *     Line in Navi Mumbai, which is;
 *   - on the catalogue's rate card (₹18/kg gross, ₹6/kg handling) 37.5 kg nets exactly
 *     ₹450.00 — a figure the server computes from the weighed mass, not one the screen
 *     states.
 */
export const DEMO_LOAD = {
  itemCode: "ECO-2026-0451",
  label: "Inverter batteries · 2 × sealed lead-acid",
  stream: "lead-acid",
  streamLabel: "Lead-acid batteries",
  hazardNotes: ["Sealed lead-acid, casing intact", "Terminals taped"],
  declaredMassG: 37_500,
  collectorId: "C-1042",
  collectorName: "Sunita Pawar",
  city: "Mumbai",
  wardCode: "K-W",
} as const;

export type DemoLoad = typeof DEMO_LOAD;
