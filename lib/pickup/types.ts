/**
 * The smart-pickup API's shapes, as the screens read them. Written from
 * `aws/pickup/index.mjs` and kept to the fields a screen uses — the API returns more.
 */

export interface PickupHandoffState {
  attemptsRemaining: number;
  locked: boolean;
  expired: boolean;
  expiresAt: string | null;
}

export interface PickupView {
  pickupId: string;
  status: "assigned" | "settled";
  itemCode: string;
  collectorId: string;
  stream: string;
  streamLabel: string;
  hazardous: boolean;
  city: string;
  declaredMassG: number;
  weighedMassG?: number;
  facilityId: string;
  facilityName: string;
  cpcbLicense: string;
  facilityCity: string;
  distanceKm: number;
  etaMinutes: number;
  routeLabel: string;
  requestedAt: string;
  settledAt?: string;
  creditNoteId?: string;
  creditNoteAmountPaise?: number;
  payoutStatus?: "pending" | "paid";
  payoutRef?: string;
  payoutVpa?: string;
  payoutAmountPaise?: number;
  paidAt?: string;
  pinExpiresAt?: string;
  routing?: {
    refused?: Array<{ facilityId: string; facilityName?: string; rule: string; reason: string }>;
  };
  handoff?: PickupHandoffState;
}

export interface CreditNoteView {
  noteId: string;
  amountPaise: number;
  grossPaise: number;
  handlingPaise: number;
  ratePaisePerKg: number;
  handlingPaisePerKg: number;
  massG: number;
  declaredMassG: number;
  massVariancePct: number;
  flags: string[];
  complianceRef: string;
  issuedAt: string;
}

/** Shown once, on the phone, in the response that minted it. */
export interface HandoffPin {
  pin: string;
  expiresAt: string;
  ttlSeconds: number;
  maxAttempts: number;
}

export interface PickupEvent {
  pickupId: string;
  kind:
    | "routed"
    | "pin_issued"
    | "pin_reissued"
    | "pin_failed"
    | "pin_locked"
    | "pin_verified"
    | "settled"
    | "payout_sent";
  at: string;
  actorSub: string | null;
  actorRole: string | null;
  details: Record<string, unknown>;
}

export interface StreamRate {
  code: string;
  label: string;
  hazardous: boolean;
  ratePaisePerKg: number;
  handlingPaisePerKg: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    attemptsRemaining?: number | null;
    fields?: Record<string, string>;
  };
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error?.message === "string"
  );
}

/** `₹450.00` from 45000 paise — the gate shows paise exactly, never rounded to rupees. */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
