/**
 * Shared domain model for the EcoEPR demo.
 *
 * Everything the UI renders is driven by the hardcoded fixtures in `lib/data/`.
 * These types are the contract between those fixtures and the pages, so they are
 * deliberately explicit rather than inferred.
 */

/**
 * Routes are split in two: the working product an operator uses every day, and
 * the feature write-ups that explain why it is built this way.
 */
export type FeatureSlug =
  | "intake"
  | "valuation"
  | "gatekeeper"
  | "pickup"
  | "heatmap"
  | "roadmap";

/**
 * The product surface. The dashboard lives at `/dashboard`, not `/`, because `/`
 * is the public landing page — a signed-out visitor is the audience there.
 */
export type ProductHref =
  | "/dashboard"
  | "/intake"
  | "/valuation"
  | "/validation"
  | "/pickups"
  | "/handoff"
  | "/gate"
  | "/demo"
  | "/map"
  | "/collectors"
  | "/recyclers"
  | "/evidence"
  | "/team"
  | "/rates";

/**
 * The sign-in flow. Public: these are the pages a landing CTA is allowed to send a
 * brand buyer to, and the only routes that render before a session exists.
 */
export type AuthHref = "/login" | "/signup" | "/confirm" | "/no-access";

/**
 * Priority rank, 1 = highest. Mirrors the ranking in `docs/ecoepr-track03.md`.
 * Rank 6 (WhatsApp) is intentionally last: it is a channel, not a capability.
 */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6;

export type FeatureStatus = "core" | "supporting" | "deferred";

export interface Feature {
  rank: Rank;
  slug: FeatureSlug;
  /**
   * The working screen that delivers the capability, or null when the capability
   * is deferred and has no product surface yet (WhatsApp intake).
   */
  productHref: ProductHref | null;
  /** What the product screen is called in navigation. */
  productName: string | null;
  /** Short name for navigation. */
  name: string;
  /** One line describing the capability. */
  tagline: string;
  /** The single job this screen does. */
  pageJob: string;
  status: FeatureStatus;
  /** AWS services this capability depends on. */
  aws: string[];
  /** Why it holds this rank. */
  proof: string;
}

/* ------------------------------------------------------------------ intake */

export type InputMode = "photo" | "voice";

export interface VoiceNote {
  language: string;
  durationSeconds: number;
  /** Verbatim Hindi transcript as the speech recogniser returned it (Azure Speech, hi-IN). */
  transcript: string;
  translation: string;
  words: number;
}

export interface ExtractedField {
  label: string;
  value: string;
  confidence: number;
  /** Where the value came from, so the user can trust it. */
  source: InputMode;
}

export interface IntakeSample {
  id: string;
  /** What the collector said or photographed. */
  subject: string;
  mode: InputMode;
  capturedAt: string;
  voiceNote?: VoiceNote;
  extracted: ExtractedField[];
  /** Item this sample resolves to in `lib/data/inventory.ts`. */
  resolvedItemId: string;
}

/* --------------------------------------------------------------- valuation */

export type MaterialCategory = "precious" | "base" | "hazardous" | "inert";

export interface MaterialLine {
  id: string;
  name: string;
  /** Chemical symbol, shown as the short mono marker. */
  symbol: string;
  category: MaterialCategory;
  massGrams: number;
  /** INR per kilogram, from the fixture rate card. */
  ratePerKg: number;
  handling: string;
}

export interface Valuation {
  grossValue: number;
  handlingFee: number;
  netToCollector: number;
  /** Brand liability offset created by diverting this unit formally. */
  eprCreditInr: number;
  eprCreditNote: string;
  rateBasis: string;
  validUntil: string;
}

export type Verdict = "verified" | "rejected" | "review";

export interface GatekeeperVerdict {
  verdict: Verdict;
  /** 0–1 model confidence on the valid/invalid boolean. */
  confidence: number;
  modelVersion: string;
  checkedAt: string;
  /**
   * Reject rule that fired, when one did — R-01 not e-waste, R-02 duplicate hash,
   * R-03 working device, R-04 battery swelling. Absent when nothing was triggered,
   * which is the normal case for a verified item.
   */
  ruleCode?: string;
  /** Classification the item was matched against. */
  matchedClass: string;
  reason: string;
  signals: { label: string; value: string }[];
}

export type ItemCondition = "working" | "dead" | "damaged";

/**
 * Compact item summary built on the server and handed to the intake console, so
 * the client component never reaches into the inventory fixture itself.
 */
export interface ResolvedItemSummary {
  id: string;
  label: string;
  category: string;
  brand: string;
  condition: ItemCondition;
  massGrams: number;
  netToCollector: number;
  creditNote: string;
  verdict: Verdict;
}

export interface EwasteItem {
  id: string;
  label: string;
  category: string;
  brand: string;
  condition: ItemCondition;
  massGrams: number;
  city: string;
  /** Hazard notes a recycler must be told about before accepting. */
  hazards: string[];
  materials: MaterialLine[];
  valuation: Valuation;
  gatekeeper: GatekeeperVerdict;
}

/* -------------------------------------------------------------- gatekeeper */

export interface ModelMetric {
  label: string;
  value: number;
  target: number;
  /** "pct" renders as a percentage, "raw" as a 0–1 score. */
  unit: "pct" | "raw";
  note: string;
}

export interface ValidationRecord {
  id: string;
  subject: string;
  collector: string;
  submittedAt: string;
  verdict: Verdict;
  confidence: number;
  reason: string;
}

export interface RejectRule {
  code: string;
  rule: string;
  note: string;
}

/** A held record waiting on a human decision in the validation queue. */
export interface PendingDecision {
  id: string;
  subject: string;
  collector: string;
  submittedAt: string;
  confidence: number;
  reason: string;
}

/** What a rule already refused, shown as context beside the pending queue. */
export interface RefusedCase {
  id: string;
  subject: string;
  rule: string;
  reason: string;
}

/* --------------------------------------------------------------- operations */

export interface Collector {
  id: string;
  name: string;
  city: string;
  pickups: number;
  creditsInr: number;
  tier: "new" | "verified" | "lead";
  languages: string[];
}

export interface Recycler {
  id: string;
  name: string;
  /** CPCB registration number — the compliance identity. */
  cpcbId: string;
  city: string;
  capacityTonnesPerDay: number;
  accepts: string[];
  slaHours: number;
}

export type PickupStatus =
  | "requested"
  | "assigned"
  | "in-transit"
  | "received"
  | "settled";

export interface PickupStep {
  label: string;
  at: string;
  done: boolean;
}

export interface Pickup {
  id: string;
  collectorId: string;
  recyclerId: string;
  itemId: string;
  status: PickupStatus;
  distanceKm: number;
  etaMinutes: number;
  /** Hazardous loads may only be routed to authorised recyclers. */
  hazardous: boolean;
  creditNote: string;
  settledInr: number;
  steps: PickupStep[];
}

/* -------------------------------------------------------------------- geo */

/**
 * A ward as the ranking and van-round components take it. Built from live data by
 * `lib/heatmap/view.ts`; there is no fixture behind it.
 */
export interface Ward {
  id: string;
  name: string;
  city: string;
  /** Relative pressure, 0–100: detections per km² against the busiest ward. */
  density: number;
  /** Detections in the window. */
  pickups: number;
  /** Detected sites in the ward. */
  flaggedSites: number;
}

/** A detected site, as the table and van round take it. Built by `lib/heatmap/view.ts`. */
export interface HotspotCluster {
  id: string;
  label: string;
  wardId: string;
  landMark: string;
  radiusM: number;
  detections: number;
  topMaterial: string;
  firstSeen: string;
  status: "open" | "van-assigned" | "cleared";
}

/* --------------------------------------------------------------- activity */

/** What produced an operator-facing event. */
export type ActivityKind =
  | "intake"
  | "valuation"
  | "validation"
  | "pickup"
  | "settled";

/* ---------------------------------------------------------- stored records */

/**
 * The priced item a database row holds, as the screens read it.
 *
 * These types are the contract between `lib/records` and the pages, the way the
 * fixture types above are the contract between `lib/data` and the pages. The shapes
 * are deliberately the same where the two overlap (`materials`, `valuation`,
 * `gatekeeper`), so a screen renders a stored price and a sample price the same way
 * and the reader can tell which is which from where the row came from, not from its
 * shape.
 */

/** A valuation row: the money, and where the rate behind it came from. */
export interface StoredValuation {
  grossValue: number;
  handlingFee: number;
  netToCollector: number;
  eprCreditInr: number;
  /**
   * The note id, or null: it belongs to an `epr_credit_notes` row, which is the money
   * half of the schema and has no writer yet. A screen says the note is not on file
   * rather than printing an id nothing can be looked up by.
   */
  eprCreditNote: string | null;
  rateBasis: string;
  /** ISO, or null when the card in force carried no expiry. */
  validUntil: string | null;
  summary: string | null;
  /** The model that produced the assay the price was computed from. */
  model: string | null;
  computedAt: string;
}

/** The compact form of a stored item, for a table row or a feed line. */
export interface StoredItemSummary {
  /** `items.code` — the id the priced result carried, and the one on screen. */
  id: string;
  /** `intakes.code` of the submission it resolved from, when the join resolves. */
  intakeCode: string | null;
  label: string;
  category: string;
  /** Null when the plate was unread — never "Unread" stored as a brand. */
  brand: string | null;
  condition: ItemCondition;
  massGrams: number;
  /** The latest verdict, or null when the item has none recorded. */
  verdict: Verdict | null;
  confidence: number | null;
  netToCollector: number | null;
  eprCreditInr: number | null;
  eprCreditNote: string | null;
  /** ISO — when the item row was written. */
  storedAt: string;
}

/** The three ways a held item leaves the validation queue, as the enum spells them. */
export type StoredDecisionKind =
  | "approved_recyclable"
  | "sent_to_reuse"
  | "rejected_non_ewaste";

/** One human decision over a gatekeeper verdict. Only approval releases money. */
export interface StoredDecision {
  id: string;
  itemCode: string;
  itemLabel: string;
  decision: StoredDecisionKind;
  reason: string | null;
  decidedAt: string;
  /** `users.full_name` where the decider resolved; null where no row exists yet. */
  decidedByName: string | null;
  undoneAt: string | null;
  /** What the decision releases, when the item carried a valuation. */
  netToCollector: number | null;
}

/** A stored item with everything the valuation workspace needs to render it. */
export interface StoredItem extends StoredItemSummary {
  materials: MaterialLine[];
  hazards: string[];
  valuation: StoredValuation | null;
  gatekeeper: GatekeeperVerdict | null;
  /** The latest decision that has not been undone, when one was taken. */
  decision: StoredDecision | null;
}

/** One submission, joined to what it was priced as. */
export interface StoredIntake {
  /** `intakes.code` — the identity the priced result carries. */
  id: string;
  summary: string | null;
  mode: InputMode;
  submittedAt: string;
  model: string | null;
  confidence: number | null;
  latencyMs: number | null;
  /** The parsed record, as `intake_fields` holds it. Empty when none was kept. */
  fields: ExtractedField[];
  item: StoredItemSummary | null;
}

/**
 * One line of the operator-facing activity feed, built from stored rows.
 *
 * Deliberately not `ActivityEvent`: that type carries pre-formatted strings a fixture
 * authored. These rows are shaped from an instant, so the screen renders a real clock.
 */
export interface StoredEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  subject: string;
  detail: string;
  actor: string;
  href: ProductHref;
}

/**
 * Every count the dashboard shows, each one a query.
 *
 * `null` on a ratio means "no rows to take a share of", which is a different thing
 * from zero and has to be rendered differently.
 */
export interface StoredCounts {
  intakesToday: number;
  intakesTotal: number;
  voiceShare: number | null;
  medianLatencySeconds: number | null;
  itemsPriced: number;
  hazardousItems: number;
  verified: number;
  held: number;
  rejected: number;
  awaitingDecision: number;
  decidedToday: number;
  /** Net promised to collectors on cleared items — a promise, not a payout. */
  netPayableInr: number;
  eprCreditInr: number;
}

/**
 * Every read in `lib/records` answers with this wrapper, so a screen can say whether
 * the database is absent, broken, or simply empty — three states that look identical
 * if a read answers with a bare array. Same posture as `lib/s3/*`.
 */
export interface RecordsResult<T> {
  configured: boolean;
  error: string | null;
  rows: T[];
}

/* --------------------------------------------------------------- evidence */

/**
 * One archived object, as a screen needs it.
 *
 * Shaped for the client viewer the way `PendingDecision` is shaped for the decision
 * queue: the component that renders it must not reach into `lib/s3/*`, which imports
 * the AWS SDK and the database client, and a client bundle has no business carrying
 * either. `kind` reuses `InputMode` because the schema does: a media asset is a photo
 * or a voice note, which is the same distinction as an intake's mode.
 */
export interface EvidenceAsset {
  /** `media_assets.id` — the surrogate key, not what identifies the bytes. */
  id: string;
  /** The content-addressed S3 key, and the only string the read API will sign. */
  storageKey: string;
  kind: InputMode;
  /**
   * The submission this object produced, as `intakes.code` holds it: for a live
   * submission that is the id the priced result carries (`LIVE-2026-…`), which is the
   * same string every screen shows for that valuation, so an operator can look the
   * evidence up by an id they already have.
   *
   * Null for an object archived before submissions were recorded, for a clip submitted
   * beside a photograph (`intakes.media_id` is unique — one asset per submission), and
   * for a request whose analysis failed and so was never priced.
   */
  submissionCode: string | null;
  /** When the submission was recorded, ISO. Null wherever `submissionCode` is. */
  submittedAt: string | null;
  mimeType: string | null;
  byteSize: number | null;
  checksumSha256: string | null;
  /** ISO timestamp as the database returned it. */
  uploadedAt: string;
  /**
   * `users.full_name` where the uploader resolved, and `null` where no row exists.
   * Null is the normal case today, not a failure: nothing provisions a `users` row
   * on sign-in yet, so most evidence is genuinely unattributed.
   */
  uploaderName: string | null;
}
