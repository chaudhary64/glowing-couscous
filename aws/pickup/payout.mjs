/**
 * `ecoepr-pickup-payout` — the money half of settlement, off the pickups table's
 * DynamoDB Stream.
 *
 * Settlement is the gate's promise: PIN checked, load weighed, note issued, all in one
 * transaction, answered instantly. Paying the collector is a different kind of work — it
 * talks to a payment rail, it can be slow, and it can fail and need retrying — so it is
 * not done inside that request. Settlement writes `payoutStatus = pending`, the stream
 * carries the change here, and this function sends the UPI credit and writes
 * `payoutStatus = paid` with the reference. The collector's phone is polling the pickup;
 * the flip to `paid` is what shows the "UPI payment successful" screen.
 *
 * **The rail is simulated.** Nothing here moves money: the reference is derived from the
 * note id, the VPA is a placeholder built from the collector id, and both the stored item
 * and the event say `simulated: true`. Swapping in a real payout API (Razorpay X,
 * Cashfree Payouts) is a change to `sendUpiCredit` alone — the trigger, the idempotency
 * and the trail stay as they are.
 *
 * **At-least-once in, exactly-once out.** A stream may deliver a record twice, and a
 * failed batch is retried. `markPaid` is conditional on `payoutStatus = pending`, so the
 * second delivery fails the condition and is skipped as already paid; and the reference
 * is a function of the note, so even a payout that succeeded but lost its write would
 * resend under the same reference — the idempotency key a real rail deduplicates on.
 *
 * Deployed with an event-source filter (see `scripts/pickup-setup.sh`) so the function
 * is only invoked for records where a load just moved to settled; `isSettlement` repeats
 * that test, because the local stream poller has no filter and a filter is
 * configuration, not a guarantee the code can lean on.
 */
import { fromItem } from "./dynamo.mjs";
import { markPaid, pickupEvent } from "./repository.mjs";

const SERVICE = "ecoepr-pickup-payout";

export const handler = async (event) => {
  const failures = [];
  for (const record of event?.Records ?? []) {
    try {
      await handleRecord(record);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          service: SERVICE,
          message: error?.message ?? String(error),
          name: error?.name,
          sequence: record?.dynamodb?.SequenceNumber ?? null,
        }),
      );
      // Report the one record, not the batch: with `ReportBatchItemFailures` the stream
      // retries from here, and the loads before it are not paid twice.
      failures.push({ itemIdentifier: record?.dynamodb?.SequenceNumber });
    }
  }
  return { batchItemFailures: failures };
};

/** True for the one transition that pays: a load's META item moving to settled, pending payout. */
export function isSettlement(record) {
  if (record?.eventName !== "MODIFY") return false;
  const next = fromItem(record.dynamodb?.NewImage);
  const previous = fromItem(record.dynamodb?.OldImage);
  return (
    next?.sk === "META" &&
    next?.status === "settled" &&
    next?.payoutStatus === "pending" &&
    previous?.status !== "settled"
  );
}

async function handleRecord(record) {
  if (!isSettlement(record)) return;
  const pickup = fromItem(record.dynamodb.NewImage);

  const payout = await sendUpiCredit({
    noteId: pickup.creditNoteId,
    collectorId: pickup.collectorId,
    amountPaise: Number(pickup.creditNoteAmountPaise ?? 0),
  });

  try {
    await markPaid({
      pickupId: pickup.pickupId,
      payout,
      events: [
        pickupEvent(pickup.pickupId, "payout_sent", {
          at: payout.paidAt,
          details: {
            rail: "upi",
            ref: payout.ref,
            vpa: payout.vpa,
            amountPaise: payout.amountPaise,
            noteId: pickup.creditNoteId,
            simulated: true,
          },
        }),
      ],
    });
  } catch (error) {
    if (error?.name === "TransactionCanceledException") {
      // Already paid — a redelivered record. The first delivery wrote the trail.
      console.log(JSON.stringify({ level: "info", service: SERVICE, event: "payout_duplicate", pickupId: pickup.pickupId }));
      return;
    }
    throw error;
  }

  console.log(
    JSON.stringify({
      level: "info",
      service: SERVICE,
      event: "payout_sent",
      pickupId: pickup.pickupId,
      noteId: pickup.creditNoteId,
      amountPaise: payout.amountPaise,
      ref: payout.ref,
    }),
  );
}

/**
 * The simulated UPI rail. A 12-digit reference, the shape of an NPCI RRN, derived from
 * the note id so the same note always produces the same reference.
 */
export async function sendUpiCredit({ noteId, collectorId, amountPaise }) {
  return {
    ref: upiReference(noteId),
    vpa: `${String(collectorId).toLowerCase().replace(/[^a-z0-9.-]/g, "")}@ecoepr`,
    amountPaise,
    paidAt: new Date().toISOString(),
  };
}

export function upiReference(seed) {
  // Two FNV-1a passes with different offsets, six digits each — enough spread for a
  // demo reference without pulling in a hash module for twelve digits.
  const fnv = (text, offset) => {
    let hash = offset;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return String((hash >>> 0) % 1_000_000).padStart(6, "0");
  };
  return `${fnv(seed, 2166136261)}${fnv(`upi:${seed}`, 2166136261)}`;
}
