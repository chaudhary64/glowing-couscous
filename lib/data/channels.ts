import type { Channel } from "@/lib/types";

/**
 * Delivery channels, ordered by priority. WhatsApp is last on purpose: it is the
 * same Gemini pipeline behind different plumbing, so it adds integration risk
 * without adding capability.
 */
export const channels: Channel[] = [
  {
    id: "web",
    name: "Web intake (photo + voice)",
    rank: 2,
    status: "shipped",
    effort: "Built",
    reach: "Any collector with a browser",
    why: "Proves the capability end to end and is the demo surface.",
    blockers: [],
  },
  {
    id: "voice",
    name: "Hindi voice note",
    rank: 2,
    status: "shipped",
    effort: "Built on Gemini audio",
    reach: "Collectors who describe items instead of typing",
    why: "The differentiator. Speech is how 1.5M informal collectors already work.",
    blockers: [],
  },
  {
    id: "android",
    name: "Low-data Android app",
    rank: null,
    status: "next",
    effort: "1 sprint, offline queue",
    reach: "Field collectors on 3G with patchy signal",
    why: "Keeps the pipeline usable where a browser tab dies; caches photos offline.",
    blockers: ["Offline sync design", "Play Store review"],
  },
  {
    id: "ivr",
    name: "Missed-call IVR lookup",
    rank: null,
    status: "deferred",
    effort: "Telephony vendor + 1 week",
    reach: "Feature-phone collectors with no data",
    why: "Widest possible reach, but a second speech stack to maintain.",
    blockers: ["Vendor contract", "Duplicate STT path"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp voice-note intake",
    rank: 6,
    status: "deferred",
    effort: "Webhook plumbing + business-account approval",
    reach: "Collectors already living in WhatsApp",
    why: "Re-transports the exact pipeline already shipped in-app, so it earns nothing on stage.",
    blockers: [
      "WhatsApp Business account approval",
      "Webhook and media-download steps that can fail live",
      "Template message rules for outbound payouts",
    ],
  },
];

export const whatsappVerdict = {
  decision: "Not in this build",
  headline:
    "A channel, not a capability. Same Gemini pipeline, more moving parts, zero new intelligence.",
  demoLine:
    "If a judge asks how collectors reach us: web app today, WhatsApp next, one pipeline behind both.",
  costOfBuilding: "3–5 days of integration for no change in what the AI can do",
  costOfSkipping: "Some collectors stay on a channel we do not cover yet",
};
