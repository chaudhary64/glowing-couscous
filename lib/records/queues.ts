import { desc, eq, inArray } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import {
  gatekeeperVerdicts,
  intakeFields,
  intakes,
  itemHazards,
  items,
  materialLines,
  users,
  validationDecisions,
  valuations,
  verdictSignals,
} from "@/db/schema";

import type {
  ExtractedField,
  GatekeeperVerdict,
  InputMode,
  MaterialLine,
  RecordsResult,
  StoredCounts,
  StoredDecision,
  StoredDecisionKind,
  StoredEvent,
  StoredIntake,
  StoredItem,
  StoredItemSummary,
  StoredValuation,
  Verdict,
} from "@/lib/types";

/**
 * Reading the priced record back.
 *
 * The writes in `lib/records/items.ts` and `lib/records/decisions.ts` are the only
 * reason this file exists: until they landed, every screen under `app/(product)/` read
 * `lib/data`, and the counts on them were authored rather than counted. These are the
 * queries that replace those fixtures — intake tallies and the capture log, the priced
 * queue, the holds waiting on a human, the decisions taken, and the dashboard's
 * snapshot of all of it.
 *
 * Four rules, copied from `lib/s3/media-assets.ts` because a read that reports its own
 * state is what keeps a demo honest:
 *
 * 1. **No `DATABASE_URL` is not an error.** Every read answers with `configured: false`
 *    and an empty `rows`, and the screen says the archive is off rather than rendering
 *    an empty table that looks like an empty database.
 *
 * 2. **A failed read is a sentence, never a thrown page.** The driver's inner cause is
 *    reported the way the writes report it, logged, and returned in `error`.
 *
 * 3. **"Latest" is decided in code, not by a lateral join.** `gatekeeper_verdicts` and
 *    `valuations` are both allowed more than one row per item, so each read takes the
 *    newest row per item from a descending scan. At pilot scale that is a handful of
 *    rows, and it is one obvious place to move into SQL when it stops being one.
 *
 * 4. **Money is summed in code, not with `sum()`.** `node-postgres` returns a `bigint`
 *    — and every aggregate over one — as a **string**, because a JS number cannot hold
 *    64 bits. `sum(net_to_collector_paise)` therefore arrives as `"11300"`, and adding
 *    those with `+` concatenates. Drizzle converts a *column* on read (`mode: "number"`)
 *    but not an aggregate expression, so the rows are fetched and totalled here.
 */

/* ------------------------------------------------------------------- common */

/** The shape every read failure takes, so the four rules above are written once. */
function failed<T>(kind: string, error: unknown): RecordsResult<T> {
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  const message = (cause ?? (error instanceof Error ? error.message : String(error)))
    .replace(/\s+/g, " ")
    .trim();
  console.error(`[db] reading ${kind} failed`, message);
  return { configured: true, error: message.slice(0, 200), rows: [] };
}

/** An empty answer for a deployment with no database, which is not a failure. */
function notConfigured<T>(): RecordsResult<T> {
  return { configured: false, error: null, rows: [] };
}

/** A `numeric(...)` column reads as a string; a screen needs the number. */
function grams(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Same for `numeric(4,3)` scores. */
function score(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The newest row per item, from a scan that was already ordered newest-first.
 *
 * First-wins rather than last-wins, because the ordering is the newest-first one every
 * caller passes in; a silent reversal here would report yesterday's verdict as current.
 */
function latestBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

/**
 * The start of the current day in IST, as an instant.
 *
 * "Today" on these screens is a Mumbai day: the pilot runs on IST, the platform stores
 * UTC, and a count that reset at 05:30 local time would report a day nobody worked.
 * IST is a fixed offset with no daylight saving, so this is arithmetic.
 */
export function startOfIstDay(now = new Date()): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(midnightUtc - IST_OFFSET_MS);
}

/* ----------------------------------------------------------------- items out */

interface ItemRow {
  id: string;
  code: string;
  intakeCode: string | null;
  label: string;
  category: string;
  brand: string | null;
  condition: StoredItemSummary["condition"];
  massG: string | null;
  createdAt: Date;
}

const itemColumns = {
  id: items.id,
  code: items.code,
  intakeCode: intakes.code,
  label: items.deviceLabel,
  category: items.deviceCategory,
  brand: items.brand,
  condition: items.condition,
  massG: items.massG,
  createdAt: items.createdAt,
};

function valuationFromRow(row: typeof valuations.$inferSelect): StoredValuation {
  return {
    // The schema stores paise; every screen in the app speaks rupees. The division is
    // here and nowhere else, so a figure read from a row and a figure computed live
    // cannot end up in different units.
    grossValue: row.grossValuePaise / 100,
    handlingFee: row.handlingFeePaise / 100,
    netToCollector: row.netToCollectorPaise / 100,
    eprCreditInr: row.eprCreditPaise / 100,
    /*
      Null, and deliberately so: the note id belongs to an `epr_credit_notes` row, which
      is the money half of the schema and has no writer yet. Printing an id here would
      mean minting one on read that no table holds, and the point of this file is that a
      stored figure can be traced back to a row. The screen says the note is not on file
      instead of showing an id nothing can be looked up by.
    */
    eprCreditNote: null,
    rateBasis: row.rateBasis ?? "",
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    summary: row.summary,
    model: row.model,
    computedAt: row.computedAt.toISOString(),
  };
}

function verdictFromRow(
  row: typeof gatekeeperVerdicts.$inferSelect,
  signals: typeof verdictSignals.$inferSelect[],
): GatekeeperVerdict {
  return {
    verdict: row.verdict,
    confidence: score(row.confidence) ?? 0,
    modelVersion: row.modelVersion,
    checkedAt: row.checkedAt.toISOString(),
    ruleCode: undefined,
    matchedClass: row.matchedClass ?? "Unclassified",
    reason: row.reason ?? "",
    signals: signals
      .filter((signal) => signal.verdictId === row.id)
      .map((signal) => ({ label: signal.label, value: signal.value })),
  };
}

/**
 * Everything hanging off a set of items, in one round of queries rather than one per
 * item — five reads for the whole page instead of five per row.
 */
async function assembleItems(rows: ItemRow[]): Promise<StoredItem[]> {
  if (rows.length === 0) return [];
  const connection = database();
  if (!connection) return [];
  const { db } = connection;
  const ids = rows.map((row) => row.id);

  const [valuationRows, verdictRows, materialRows, hazardRows, decisionRows] =
    await Promise.all([
      db
        .select()
        .from(valuations)
        .where(inArray(valuations.itemId, ids))
        .orderBy(desc(valuations.computedAt)),
      db
        .select()
        .from(gatekeeperVerdicts)
        .where(inArray(gatekeeperVerdicts.itemId, ids))
        .orderBy(desc(gatekeeperVerdicts.checkedAt)),
      db
        .select()
        .from(materialLines)
        .where(inArray(materialLines.itemId, ids))
        .orderBy(materialLines.ordinal),
      db
        .select()
        .from(itemHazards)
        .where(inArray(itemHazards.itemId, ids))
        .orderBy(itemHazards.ordinal),
      db
        .select({
          id: validationDecisions.id,
          itemId: validationDecisions.itemId,
          decision: validationDecisions.decision,
          reason: validationDecisions.reason,
          decidedAt: validationDecisions.decidedAt,
          undoneAt: validationDecisions.undoneAt,
          decidedByName: users.fullName,
          itemCode: items.code,
          itemLabel: items.deviceLabel,
        })
        .from(validationDecisions)
        .innerJoin(items, eq(validationDecisions.itemId, items.id))
        .leftJoin(users, eq(validationDecisions.decidedByUserId, users.id))
        .where(inArray(validationDecisions.itemId, ids))
        .orderBy(desc(validationDecisions.decidedAt)),
    ]);

  const verdictIds = verdictRows.map((row) => row.id);
  const signalRows =
    verdictIds.length > 0
      ? await db
          .select()
          .from(verdictSignals)
          .where(inArray(verdictSignals.verdictId, verdictIds))
          .orderBy(verdictSignals.ordinal)
      : [];

  const latestValuation = latestBy(valuationRows, (row) => row.itemId);
  const latestVerdict = latestBy(verdictRows, (row) => row.itemId);
  const liveDecision = latestBy(
    decisionRows.filter((row) => row.undoneAt === null),
    (row) => row.itemId,
  );

  return rows.map((row) => {
    const valuation = latestValuation.get(row.id) ?? null;
    const verdict = latestVerdict.get(row.id) ?? null;
    const decision = liveDecision.get(row.id) ?? null;
    const storedValuation = valuation ? valuationFromRow(valuation) : null;
    const storedVerdict = verdict ? verdictFromRow(verdict, signalRows) : null;

    const materials: MaterialLine[] = materialRows
      .filter((line) => line.itemId === row.id)
      .map((line) => ({
        id: line.id,
        name: line.materialName,
        symbol: line.symbol ?? "",
        category: line.category,
        massGrams: grams(line.massG),
        // `rate_paise_per_kg` → the ₹/kg every screen prints.
        ratePerKg: Number(line.ratePaisePerKg) / 100,
        handling: line.handlingNote ?? "",
      }));

    return {
      id: row.code,
      intakeCode: row.intakeCode,
      label: row.label,
      category: row.category,
      brand: row.brand,
      condition: row.condition,
      massGrams: grams(row.massG),
      verdict: storedVerdict?.verdict ?? null,
      confidence: storedVerdict?.confidence ?? null,
      netToCollector: storedValuation?.netToCollector ?? null,
      eprCreditInr: storedValuation?.eprCreditInr ?? null,
      eprCreditNote: storedValuation?.eprCreditNote ?? null,
      storedAt: row.createdAt.toISOString(),
      materials,
      hazards: hazardRows.filter((hazard) => hazard.itemId === row.id).map((h) => h.label),
      valuation: storedValuation,
      gatekeeper: storedVerdict,
      decision: decision
        ? {
            id: decision.id,
            itemCode: decision.itemCode,
            itemLabel: decision.itemLabel,
            decision: decision.decision,
            reason: decision.reason,
            decidedAt: decision.decidedAt.toISOString(),
            decidedByName: decision.decidedByName ?? null,
            undoneAt: null,
            netToCollector: storedValuation?.netToCollector ?? null,
          }
        : null,
    } satisfies StoredItem;
  });
}

/** The newest items this database holds, as the valuation queue shows them. */
export async function listPricedItems(limit = 12): Promise<RecordsResult<StoredItem>> {
  if (!databaseConfigured()) return notConfigured<StoredItem>();
  const connection = database();
  if (!connection) return notConfigured<StoredItem>();
  try {
    const rows = await connection.db
      .select(itemColumns)
      .from(items)
      .leftJoin(intakes, eq(items.intakeId, intakes.id))
      .orderBy(desc(items.createdAt))
      .limit(limit);
    return { configured: true, error: null, rows: await assembleItems(rows) };
  } catch (error) {
    return failed<StoredItem>("the priced queue", error);
  }
}

/** One priced item by the id it carries, for the workspace behind the queue. */
export async function getStoredItem(
  code: string,
): Promise<RecordsResult<StoredItem>> {
  if (!databaseConfigured()) return notConfigured<StoredItem>();
  const connection = database();
  if (!connection) return notConfigured<StoredItem>();
  try {
    const rows = await connection.db
      .select(itemColumns)
      .from(items)
      .leftJoin(intakes, eq(items.intakeId, intakes.id))
      .where(eq(items.code, code))
      .limit(1);
    return { configured: true, error: null, rows: await assembleItems(rows) };
  } catch (error) {
    return failed<StoredItem>("one priced item", error);
  }
}

/**
 * Every item count the dashboard and the valuation header show, each one a query.
 *
 * The verdict mix is per item — the latest verdict for each — and the money is summed
 * over cleared items only, which is the same rule the valuation screen has always
 * stated: a rejected or held item keeps its assay and promises nothing.
 */
export async function storedCounts(): Promise<RecordsResult<StoredCounts> & {
  counts: StoredCounts | null;
}> {
  if (!databaseConfigured()) {
    return { configured: false, error: null, rows: [], counts: null };
  }
  const connection = database();
  if (!connection) return { configured: false, error: null, rows: [], counts: null };

  try {
    const { db } = connection;
    const since = startOfIstDay();

    const [intakeRows, itemRows, hazardRows, verdictRows, valuationRows, decisionRows] =
      await Promise.all([
        db
          .select({
            mode: intakes.mode,
            submittedAt: intakes.submittedAt,
            latencyMs: intakes.extractionLatencyMs,
          })
          .from(intakes),
        db.select({ id: items.id }).from(items),
        db.select({ itemId: itemHazards.itemId }).from(itemHazards),
        db
          .select({
            itemId: gatekeeperVerdicts.itemId,
            verdict: gatekeeperVerdicts.verdict,
          })
          .from(gatekeeperVerdicts)
          .orderBy(desc(gatekeeperVerdicts.checkedAt)),
        db
          .select({
            itemId: valuations.itemId,
            netPaise: valuations.netToCollectorPaise,
            eprPaise: valuations.eprCreditPaise,
          })
          .from(valuations)
          .orderBy(desc(valuations.computedAt)),
        db
          .select({
            itemId: validationDecisions.itemId,
            decidedAt: validationDecisions.decidedAt,
            undoneAt: validationDecisions.undoneAt,
          })
          .from(validationDecisions),
      ]);

    const today = intakeRows.filter((row) => row.submittedAt >= since);
    const voiceToday = today.filter((row) => row.mode === "voice").length;
    const latencies = today
      .map((row) => row.latencyMs)
      .filter((value): value is number => typeof value === "number" && value > 0)
      .sort((a, b) => a - b);
    const medianLatencySeconds =
      latencies.length > 0
        ? Math.round(latencies[Math.floor((latencies.length - 1) / 2)] / 1000)
        : null;

    const latestVerdict = latestBy(verdictRows, (row) => row.itemId);
    const latestValuation = latestBy(valuationRows, (row) => row.itemId);
    const liveDecisions = decisionRows.filter((row) => row.undoneAt === null);

    let verified = 0;
    let held = 0;
    let rejected = 0;
    let awaitingDecision = 0;
    let netPayablePaise = 0;
    let eprCreditPaise = 0;

    for (const item of itemRows) {
      const verdict = latestVerdict.get(item.id)?.verdict ?? null;
      const decided = liveDecisions.some((row) => row.itemId === item.id);
      const valuation = latestValuation.get(item.id);
      if (verdict === "verified") verified += 1;
      else if (verdict === "review") held += 1;
      else if (verdict === "rejected") rejected += 1;
      if (verdict === "review" && !decided) awaitingDecision += 1;
      if (verdict === "verified" && valuation) {
        netPayablePaise += valuation.netPaise;
        eprCreditPaise += valuation.eprPaise;
      }
    }

    const hazardousItems = new Set(hazardRows.map((row) => row.itemId)).size;

    return {
      configured: true,
      error: null,
      rows: [],
      counts: {
        intakesToday: today.length,
        intakesTotal: intakeRows.length,
        voiceShare: today.length > 0 ? voiceToday / today.length : null,
        medianLatencySeconds,
        itemsPriced: itemRows.length,
        hazardousItems,
        verified,
        held,
        rejected,
        awaitingDecision,
        decidedToday: liveDecisions.filter((row) => row.decidedAt >= since).length,
        netPayableInr: Math.round(netPayablePaise / 100),
        eprCreditInr: Math.round(eprCreditPaise / 100),
      },
    };
  } catch (error) {
    const result = failed<StoredCounts>("the dashboard counts", error);
    return { ...result, counts: null };
  }
}

/* --------------------------------------------------------------- intakes out */

const fieldColumns = {
  intakeId: intakeFields.intakeId,
  label: intakeFields.label,
  value: intakeFields.valueText,
  confidence: intakeFields.confidence,
  source: intakeFields.source,
  ordinal: intakeFields.ordinal,
};

/** The submissions this database holds, newest first, joined to what they became. */
export async function listRecentIntakes(
  limit = 6,
): Promise<RecordsResult<StoredIntake>> {
  if (!databaseConfigured()) return notConfigured<StoredIntake>();
  const connection = database();
  if (!connection) return notConfigured<StoredIntake>();

  try {
    const { db } = connection;
    const rows = await db
      .select({
        id: intakes.id,
        code: intakes.code,
        summary: intakes.summary,
        mode: intakes.mode,
        submittedAt: intakes.submittedAt,
        model: intakes.extractionModel,
        confidence: intakes.extractionConfidence,
        latencyMs: intakes.extractionLatencyMs,
      })
      .from(intakes)
      .orderBy(desc(intakes.submittedAt))
      .limit(limit);

    if (rows.length === 0) return { configured: true, error: null, rows: [] };

    const intakeIds = rows.map((row) => row.id);
    const [fieldRows, itemRows] = await Promise.all([
      db
        .select(fieldColumns)
        .from(intakeFields)
        .where(inArray(intakeFields.intakeId, intakeIds))
        .orderBy(intakeFields.ordinal),
      db
        .select({ ...itemColumns, intakeId: items.intakeId })
        .from(items)
        .leftJoin(intakes, eq(items.intakeId, intakes.id))
        .where(inArray(items.intakeId, intakeIds)),
    ]);

    // The item's verdict and price come from the same assembly the queue uses, so a
    // submission's "resolved item" column cannot disagree with the valuation screen.
    // Keyed by the item's own `intake_id`, not by `items.id`: the surrogate key appears
    // on neither the row this screen renders nor the intake it comes from.
    //
    // The pairing is positional because `assembleItems` maps over the rows it is given
    // and returns them in the same order — it never sorts, filters or dedupes.
    const assembled = await assembleItems(itemRows);
    const byIntake = new Map<string, StoredItemSummary>();
    itemRows.forEach((row, index) => {
      const item = assembled[index];
      if (item) byIntake.set(row.intakeId, item);
    });

    return {
      configured: true,
      error: null,
      rows: rows.map((row) => ({
        id: row.code,
        summary: row.summary,
        mode: row.mode as InputMode,
        submittedAt: row.submittedAt.toISOString(),
        model: row.model,
        confidence: score(row.confidence),
        latencyMs: row.latencyMs,
        fields: fieldRows
          .filter((field) => field.intakeId === row.id)
          .map(
            (field): ExtractedField => ({
              label: field.label,
              value: field.value,
              confidence: score(field.confidence) ?? 0,
              source: field.source as InputMode,
            }),
          ),
        item: byIntake.get(row.id) ?? null,
      })),
    };
  } catch (error) {
    return failed<StoredIntake>("the capture log", error);
  }
}

/* ------------------------------------------------------------ validation out */

/**
 * The items the model would not decide alone, and that no human has decided yet.
 *
 * A hold leaves this list when a `validation_decisions` row exists for it — including
 * one that has since been undone, which is why "live" means `undone_at is null`. The
 * undo is a new state on the record, never a deletion.
 */
export async function listPendingHolds(
  limit = 12,
): Promise<RecordsResult<StoredItem>> {
  if (!databaseConfigured()) return notConfigured<StoredItem>();
  const connection = database();
  if (!connection) return notConfigured<StoredItem>();

  try {
    const { db } = connection;
    const [verdictRows, decisionRows] = await Promise.all([
      db
        .select({
          itemId: gatekeeperVerdicts.itemId,
          verdict: gatekeeperVerdicts.verdict,
        })
        .from(gatekeeperVerdicts)
        .orderBy(desc(gatekeeperVerdicts.checkedAt)),
      db
        .select({
          itemId: validationDecisions.itemId,
          undoneAt: validationDecisions.undoneAt,
        })
        .from(validationDecisions),
    ]);

    const decided = new Set(
      decisionRows.filter((row) => row.undoneAt === null).map((row) => row.itemId),
    );
    const latest = latestBy(verdictRows, (row) => row.itemId);
    const held = [...latest.values()]
      .filter((row) => row.verdict === "review" && !decided.has(row.itemId))
      .map((row) => row.itemId)
      .slice(0, limit);

    if (held.length === 0) return { configured: true, error: null, rows: [] };

    const rows = await db
      .select(itemColumns)
      .from(items)
      .leftJoin(intakes, eq(items.intakeId, intakes.id))
      .where(inArray(items.id, held))
      .orderBy(desc(items.createdAt));

    return { configured: true, error: null, rows: await assembleItems(rows) };
  } catch (error) {
    return failed<StoredItem>("the pending holds", error);
  }
}

/** The items a rule refused before a credit could exist. */
export async function listRefusedItems(
  limit = 12,
): Promise<RecordsResult<StoredItem>> {
  if (!databaseConfigured()) return notConfigured<StoredItem>();
  const connection = database();
  if (!connection) return notConfigured<StoredItem>();

  try {
    const { db } = connection;
    const verdictRows = await db
      .select({
        itemId: gatekeeperVerdicts.itemId,
        verdict: gatekeeperVerdicts.verdict,
      })
      .from(gatekeeperVerdicts)
      .where(eq(gatekeeperVerdicts.verdict, "rejected"))
      .orderBy(desc(gatekeeperVerdicts.checkedAt));

    const refused = [...latestBy(verdictRows, (row) => row.itemId).keys()].slice(0, limit);
    if (refused.length === 0) return { configured: true, error: null, rows: [] };

    const rows = await db
      .select(itemColumns)
      .from(items)
      .leftJoin(intakes, eq(items.intakeId, intakes.id))
      .where(inArray(items.id, refused))
      .orderBy(desc(items.createdAt));

    return { configured: true, error: null, rows: await assembleItems(rows) };
  } catch (error) {
    return failed<StoredItem>("the refused items", error);
  }
}

/** Every decision on file, newest first, with who took it. */
export async function listRecentDecisions(
  limit = 12,
): Promise<RecordsResult<StoredDecision>> {
  if (!databaseConfigured()) return notConfigured<StoredDecision>();
  const connection = database();
  if (!connection) return notConfigured<StoredDecision>();

  try {
    const { db } = connection;
    const rows = await db
      .select({
        id: validationDecisions.id,
        itemId: validationDecisions.itemId,
        decision: validationDecisions.decision,
        reason: validationDecisions.reason,
        decidedAt: validationDecisions.decidedAt,
        undoneAt: validationDecisions.undoneAt,
        decidedByName: users.fullName,
        itemCode: items.code,
        itemLabel: items.deviceLabel,
      })
      .from(validationDecisions)
      .innerJoin(items, eq(validationDecisions.itemId, items.id))
      .leftJoin(users, eq(validationDecisions.decidedByUserId, users.id))
      .orderBy(desc(validationDecisions.decidedAt))
      .limit(limit);

    if (rows.length === 0) return { configured: true, error: null, rows: [] };

    const itemIds = rows.map((row) => row.itemId);
    const valuationRows = await db
      .select({
        itemId: valuations.itemId,
        netPaise: valuations.netToCollectorPaise,
        computedAt: valuations.computedAt,
      })
      .from(valuations)
      .where(inArray(valuations.itemId, itemIds))
      .orderBy(desc(valuations.computedAt));
    const latestValuation = latestBy(valuationRows, (row) => row.itemId);

    return {
      configured: true,
      error: null,
      rows: rows.map((row) => {
        const netPaise = latestValuation.get(row.itemId)?.netPaise ?? null;
        return {
          id: row.id,
          itemCode: row.itemCode,
          itemLabel: row.itemLabel,
          decision: row.decision as StoredDecisionKind,
          reason: row.reason,
          decidedAt: row.decidedAt.toISOString(),
          decidedByName: row.decidedByName ?? null,
          undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
          netToCollector: netPaise === null ? null : Number(netPaise) / 100,
        };
      }),
    };
  } catch (error) {
    return failed<StoredDecision>("the decisions", error);
  }
}

/* -------------------------------------------------------------- activity feed */

/** The words a decision is shown as in the feed, so nothing else has to translate it. */
const DECISION_WORDS: Record<StoredDecisionKind, string> = {
  approved_recyclable: "approved as recyclable",
  sent_to_reuse: "sent to reuse",
  rejected_non_ewaste: "rejected as non-e-waste",
};

/** The verdict as a feed line reads it — "cleared" is what a verified item means here. */
const VERDICT_WORDS: Record<Verdict, string> = {
  verified: "cleared",
  review: "held for review",
  rejected: "rejected",
};

/**
 * The operator feed, built from the rows rather than authored.
 *
 * `ops.activity_events` exists in the schema for exactly this and nothing writes it,
 * so the feed is a union of the three tables that do carry a timestamp: a submission,
 * a verdict, a decision. Cheaper than a second write path, and it cannot disagree with
 * the rows it is drawn from — the failure mode of a feed written beside the fact rather
 * than from it.
 */
export async function listRecentEvents(limit = 10): Promise<RecordsResult<StoredEvent>> {
  if (!databaseConfigured()) return notConfigured<StoredEvent>();
  const connection = database();
  if (!connection) return notConfigured<StoredEvent>();

  try {
    const { db } = connection;
    const [intakeRows, verdictRows, decisionRows] = await Promise.all([
      db
        .select({
          code: intakes.code,
          summary: intakes.summary,
          mode: intakes.mode,
          submittedAt: intakes.submittedAt,
          model: intakes.extractionModel,
        })
        .from(intakes)
        .orderBy(desc(intakes.submittedAt))
        .limit(limit),
      db
        .select({
          verdict: gatekeeperVerdicts.verdict,
          matchedClass: gatekeeperVerdicts.matchedClass,
          checkedAt: gatekeeperVerdicts.checkedAt,
          itemCode: items.code,
          itemLabel: items.deviceLabel,
          modelVersion: gatekeeperVerdicts.modelVersion,
        })
        .from(gatekeeperVerdicts)
        .innerJoin(items, eq(gatekeeperVerdicts.itemId, items.id))
        .orderBy(desc(gatekeeperVerdicts.checkedAt))
        .limit(limit),
      db
        .select({
          id: validationDecisions.id,
          decision: validationDecisions.decision,
          decidedAt: validationDecisions.decidedAt,
          decidedByName: users.fullName,
          itemCode: items.code,
          itemLabel: items.deviceLabel,
        })
        .from(validationDecisions)
        .innerJoin(items, eq(validationDecisions.itemId, items.id))
        .leftJoin(users, eq(validationDecisions.decidedByUserId, users.id))
        .orderBy(desc(validationDecisions.decidedAt))
        .limit(limit),
    ]);

    const events: StoredEvent[] = [
      ...intakeRows.map((row) => ({
        id: `IN-${row.code}`,
        at: row.submittedAt.toISOString(),
        kind: "intake" as const,
        subject: `${row.code} captured`,
        detail: row.summary ?? (row.mode === "voice" ? "Hindi voice note" : "Photograph"),
        actor: row.model ?? "capture panel",
        href: "/intake" as const,
      })),
      ...verdictRows.map((row) => ({
        id: `GK-${row.itemCode}-${row.checkedAt.toISOString()}`,
        at: row.checkedAt.toISOString(),
        // A cleared verdict is the price being released; a hold or a refusal is the
        // gatekeeper arriving at the validation queue.
        kind: row.verdict === "verified" ? ("valuation" as const) : ("validation" as const),
        subject: `${row.itemCode} ${VERDICT_WORDS[row.verdict]}`,
        detail: row.matchedClass ?? row.itemLabel,
        actor: row.modelVersion,
        href: row.verdict === "verified" ? ("/valuation" as const) : ("/validation" as const),
      })),
      ...decisionRows.map((row) => ({
        id: `VD-${row.id}`,
        at: row.decidedAt.toISOString(),
        kind: "validation" as const,
        subject: `${row.itemCode} ${DECISION_WORDS[row.decision]}`,
        detail: row.itemLabel,
        actor: row.decidedByName ?? "an operator",
        href: "/validation" as const,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit);

    return { configured: true, error: null, rows: events };
  } catch (error) {
    return failed<StoredEvent>("the activity feed", error);
  }
}

