# Smart pickup: the handoff PIN and the UPI payout

Feature 4 already routed a load to a licensed recycler and settled it into a credit
note (`aws/pickup/`, `scripts/pickup-setup.sh`). This adds the physical handoff between
the two, and the payment after it:

```
collector's phone            API Lambda (ecoepr-smart-pickup)          DynamoDB
─────────────────            ────────────────────────────────          ────────
"Hand over e-waste"  ──▶  POST /pickups              ──▶  load + pinHash, events
   shows PIN 4821    ◀──    routed to RX-02, PIN once
                                                                 
recycler's gate              
weighs 37.5 kg, types 4821 ▶ POST /pickups/{id}/settle ──▶ settled, note, payoutStatus=pending
   "₹450.00 · CN-…"  ◀──      (one transaction)                     │
                                                                     │ DynamoDB Stream
                             payout Lambda (ecoepr-pickup-payout) ◀──┘ (filtered: just settled)
                               simulated UPI credit ──▶ payoutStatus=paid, payoutRef, event
phone polls GET /pickups/{id} ──▶ sees paid ──▶ green "UPI payment ₹450.00 successful"
```

## Rules

| Rule | Where | Why |
|---|---|---|
| PIN from `crypto.randomInt`, stored only as a hash bound to the pickup id | `pin.mjs` | The PIN is the whole secret; no read path can return it |
| 5 wrong PINs lock the load (`423 pin_locked`) | `index.mjs` `wrongPin`, `repository.mjs` `recordPinFailure` | 4 digits is no secret against unlimited guesses; the counter is `ADD`, so concurrent guesses can't share an attempt |
| PIN expires after 15 minutes (`410 pin_expired`) | `pin.mjs` | A screenshot from this morning should not settle a load this afternoon |
| `POST /pickups/{id}/pin` issues a fresh PIN and revokes the old one | `index.mjs` `newPin` | A locked or expired PIN is a button on the phone, not a dead end |
| PIN conditions re-checked in the settle transaction | `repository.mjs` `settle` | A lock or reissue between the handler's read and the write must still win |
| Every step writes an `EVENT#…` row in the load's partition, in the same transaction as the change | `repository.mjs` `pickupEvent` | `GET /pickups/{id}/events` is the whole history in one Query; events carry no GSI keys, so ledgers and capacity stay clean |
| Payout is off the stream, conditional on `payoutStatus = pending` | `payout.mjs` | Streams deliver at least once; the condition makes payouts exactly once. The reference is derived from the note id, so a retry reuses it |
| Weighed mass prices the note; >25% off the declared mass flags it | `credits.mjs` (unchanged) | The gate previews the price and warns before the PIN is typed |

The UPI rail is **simulated** — the payout is marked `payoutSimulated: true`, and the
phone says so. A real rail (Razorpay X, Cashfree Payouts) replaces `sendUpiCredit` in
`payout.mjs` and nothing else.

## Run it locally (no AWS account, no Docker)

Needs Java (`brew install openjdk`) and a `.env.local` with the Cognito settings, so you
can sign in as an `eco-operator` or above.

```bash
npm run pickup:local -- --install   # first time: downloads DynamoDB Local into .dynamodb/
npm run pickup:local                # DynamoDB Local + tables + seed + payout stream relay
npm run pickup:test                 # 31 checks through the real Lambda handler
```

Add to `.env.local`, then `npm run dev` and open **/demo**:

```
PICKUP_LOCAL=true
PICKUP_DYNAMODB_ENDPOINT=http://127.0.0.1:8000
```

`pickup:local` must stay running: it is the stand-in for the Lambda event-source
mapping, and without it loads settle but never show as paid.

## Screens

| Path | Who | What |
|---|---|---|
| `/demo` | the video | Phone and gate side by side; the gate opens whatever the phone routes. "New handoff" starts a fresh load |
| `/handoff` | collector | The phone alone, for a real handset |
| `/gate?pickup=PU-2026-0001` | recycler | The terminal alone: open a load, weigh, PIN, audit trail |

Demo load (`lib/pickup/demo.ts`): two sealed lead-acid inverter batteries, 37.5 kg, from
Sunita Pawar (C-1042) in Mumbai. Lead-acid is hazardous, so it skips RX-01 Mumbai (not
licensed for it) and goes to RX-02 GreenLoop Battery Line; at ₹18/kg − ₹6/kg handling it
nets exactly ₹450.00.

## Deploying

`scripts/pickup-setup.sh` now also enables the pickups stream (NEW_AND_OLD_IMAGES),
creates `ecoepr-pickup-payout` with its own role (that stream and that table, nothing
else), a filtered event-source mapping with `ReportBatchItemFailures`, and the routes
`POST /pickups/{pickupId}/pin` and `GET /pickups/{pickupId}/events`. It is idempotent;
re-running it updates the existing stack in place. `scripts/pickup-check.mjs` now sends
the PIN and checks the wrong-PIN refusal.

**Breaking change for any existing caller:** `POST /pickups/{id}/settle` now requires
`pin`. Loads routed before this change have no PIN; `POST /pickups/{id}/pin` gives them
one.
