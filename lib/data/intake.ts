import type { IntakeSample } from "@/lib/types";

/**
 * Fixed intake samples, one per input mode and verdict path.
 *
 * The transcripts are real Hindi speech of the kind a scrap collector actually
 * uses, because that register is the whole point of the feature.
 */
export const intakeSamples: IntakeSample[] = [
  {
    id: "SMP-001",
    subject: "Voice note — old laptop board and battery",
    mode: "voice",
    capturedAt: "09 Oct 2026, 14:19 IST",
    resolvedItemId: "ECO-2026-0431",
    voiceNote: {
      language: "Hindi (hi-IN)",
      durationSeconds: 11,
      transcript:
        "यह पुराना मदरबोर्ड और बैटरी है, इसका क्या मिलेगा? डेल का लैपटॉप था, अब चलता नहीं।",
      translation:
        "This is an old motherboard and battery — what will I get for it? It was a Dell laptop, it doesn't run now.",
      words: 18,
    },
    extracted: [
      { label: "Item class", value: "Laptop mainboard", confidence: 0.94, source: "voice" },
      { label: "Brand", value: "Dell", confidence: 0.94, source: "voice" },
      { label: "Condition", value: "Not powering on", confidence: 0.81, source: "voice" },
      { label: "Unit count", value: "1 board + 1 battery", confidence: 0.89, source: "voice" },
      { label: "Pickup zone", value: "Mumbai · Kurla West", confidence: 0.92, source: "photo" },
    ],
  },
  {
    id: "SMP-002",
    subject: "Photo — swollen lithium-ion pack",
    mode: "photo",
    capturedAt: "09 Oct 2026, 14:26 IST",
    resolvedItemId: "ECO-2026-0432",
    extracted: [
      { label: "Item class", value: "Lithium-ion battery pack", confidence: 0.93, source: "photo" },
      { label: "Brand", value: "Samsung", confidence: 0.88, source: "photo" },
      { label: "Condition", value: "Damaged — swelling detected", confidence: 0.88, source: "photo" },
      { label: "Hazard", value: "Reactive cell, sealed transport", confidence: 0.91, source: "photo" },
      { label: "Pickup zone", value: "Mumbai · Dharavi", confidence: 0.9, source: "photo" },
    ],
  },
  {
    id: "SMP-003",
    subject: 'Voice note — "bahut bhaari purana TV"',
    mode: "voice",
    capturedAt: "09 Oct 2026, 14:31 IST",
    resolvedItemId: "ECO-2026-0433",
    voiceNote: {
      language: "Hindi (hi-IN)",
      durationSeconds: 8,
      transcript: "यह पुराना टीवी है, बहुत भारी है। इसे उठाना मुश्किल है, कोई आएगा?",
      translation:
        "This is an old TV, very heavy. It's hard to lift — will someone come?",
      words: 13,
    },
    extracted: [
      { label: "Item class", value: "CRT display", confidence: 0.71, source: "voice" },
      { label: "Brand", value: "LG", confidence: 0.76, source: "voice" },
      { label: "Weight cue", value: "Heavy — exceeds doorstep", confidence: 0.83, source: "voice" },
      { label: "Hazard", value: "Leaded glass likely", confidence: 0.74, source: "voice" },
      { label: "Pickup zone", value: "Pune · Kothrud", confidence: 0.9, source: "photo" },
    ],
  },
  {
    id: "SMP-004",
    subject: "Photo — bottle submitted as e-waste",
    mode: "photo",
    capturedAt: "09 Oct 2026, 14:44 IST",
    resolvedItemId: "ECO-2026-0436",
    extracted: [
      { label: "Item class", value: "PET container", confidence: 0.99, source: "photo" },
      { label: "Brand", value: "Unread", confidence: 0.0, source: "photo" },
      { label: "Metal signature", value: "None detected", confidence: 0.99, source: "photo" },
      { label: "Circuit signature", value: "None detected", confidence: 0.99, source: "photo" },
      { label: "Pickup zone", value: "Mumbai · Andheri East", confidence: 0.91, source: "photo" },
    ],
  },
];

/** Simple counters for the intake header. */
export const intakeStats = {
  today: 412,
  voiceShare: 0.63,
  languages: ["Hindi", "Marathi", "Gujarati", "Tamil"],
  medianTurnaroundSeconds: 6,
};
