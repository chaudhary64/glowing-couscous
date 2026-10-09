# Testing features #1–#3 in a browser, click by click

This is a runbook, not a description. Follow it top to bottom in one browser tab: each
step says **what to click** and **what you should see**. If what is on screen differs
from the "You should see" block, that is the bug — everything else on the page is a
fixture and renders whether or not the model is reachable.

The three features, in the order this runbook tests them:

| # | Feature | Screen | What you do | What comes back |
|---|---|---|---|---|
| #1 | AI Metal & EPR Valuation | `/valuation` | photo of an item | assay + price + gatekeeper verdict |
| #2 | Multi-Modal ID | `/intake` | photo and/or Hindi voice | transcript + fields + the same price |
| #3 | Fraud-Prevention Vision Gatekeeper | `/validation` | anything | `verified` / `review` / `rejected` + the rule |

> **One thing to internalise first.** On every screen the **Capture** panel at the top
> is the live feature. Everything *below* it — stat grids, sample tables, the review
> queue, the metric panels — is fixture data that renders whether the model is up or
> not. Test the panel and the result cards it inserts directly beneath itself; ignore
> the fixtures.

There is no harness, no CLI and no AWS step below. Everything is a page and a button.
(The headless checks still live in the gitignored `.freebuff/ai-check/`; you do not
need them.)

---

## 0 · Get it running

Two checks, then start it:

```bash
[ -d node_modules ] && echo "deps ok"                       # deps installed
grep -c '^AZURE_OPENAI_API_KEY=.\+' .env.local               # prints 1
npm run dev                                                 # http://localhost:3000
```

If a dev server is already running on `localhost:3000`, reuse it — do not start a
second one. Open <http://localhost:3000> in a browser.

**You should see:** the public landing page at `/`. The working screens are gated —
opening `/dashboard` or `/intake` signed out bounces to `/login?next=…` — and both the
landing page and `/doc` are readable without an account.

> **If the key is missing**, the live panel answers `ai_unavailable` (HTTP 503) and the
> screens silently fall back to sample data. That is a configuration gap, not a feature
> failure. Fix `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` in `.env.local` first,
> then restart `npm run dev`.
>
> **If the call is refused**, the panel shows the code the Azure status maps to
> (`ai_key_rejected`, `ai_model_missing`, `ai_at_capacity`, …) carrying Foundry's own
> sentence. The deployment named by `AZURE_OPENAI_DEPLOYMENT` has to exist on the
> resource behind `AZURE_OPENAI_ENDPOINT`; re-run `scripts/foundry-setup.sh` with
> `--account` to create or reuse it.

> **How the Hindi voice note runs.** The Microsoft Foundry deployment is a vision/text
> model (`gpt-4.1-mini`, in `koreacentral`); the subscription's region policy and quotas
> allow no audio-capable model (the `gpt-audio` family) and no Whisper. So the voice note
> is a **second call**: Azure Speech (`hi-IN`) transcribes it first and the verbatim
> transcript goes to the model with the photograph. Feature #2 works end to end — a
> silent clip still returns no transcript, and the failure table below lists the codes
> each call can raise.

---

## 1 · Sign in as the officer

The officer is the one role that reaches all three features, so a single sign-in drives
#1, #2 and #3.

1. The page reads **Sign in** (eyebrow *EcoEPR · Mumbai + Pune pilot*).
2. In **Email**, type `demo.officer@example.com`.
3. In **Password**, type the `DEMO_PW` you set when the demo accounts were created.
4. Click **Sign in**.

**You should see:** the Dashboard at `/dashboard`. The strip across the top reads
*Mumbai + Pune pilot · … intakes today · … credit notes* with a **Simulated data** chip.
The left rail is grouped **Operations** → *Dashboard, New intake, Valuations, Validation
queue, Pickups* and **Network** → *Hotspot map, Collectors, Recyclers*. At the bottom of
the rail: the signed-in name, an **Officer** badge, a **Sign out** link and a **Feature
documentation →** link.

> **Don't know the password?** The five demo accounts share `DEMO_PW`. Re-run the
> idempotent, no-email script with the password you want — it creates any missing
> account and resets the password on all five:
>
> ```bash
> DEMO_PW='YourPassw0rd' bash .freebuff/create-demo-accounts.sh
> ```

---

## 2 · Feature #1 — AI Metal & EPR Valuation

**Screen:** `/valuation`. **Button:** **Value this item**.

### 2.1 Open it

Click **Valuations** in the left rail.

**You should see:** the header *Operations · Valuation*, the title **Valuations**, and the
**Capture** panel directly under it with the eyebrow *Live valuation*. Its action button
is greyed out and the helper text reads *"Attach a photo, record a note, or describe the
item."* (The button stays disabled until there is some input — that is intentional.)

### 2.2 Fill it in

1. Under **1 · Photo**, choose a JPEG/PNG/WebP/HEIC under 3 MB. A laptop motherboard or a
   phone is the easy case — something unmistakably e-waste.
2. *Optional.* Under **3 · What the collector said**, type a sentence, e.g.
   `पुराना लैपटॉप मदरबोर्ड, चलता नहीं`.
   (This field exists on `/validation` too — it is shared.)
3. *Optional.* Under **4 · Declared mass (g)**, type a number, e.g. `400`.

**You should see:** the caption next to the photo reading *Attached* plus the file name,
and the button now reading **Value this item**.

### 2.3 Run it

Click **Value this item**. It relabels to **Analysing…** while the request is in flight.

**You should see** — inserted directly under the Capture panel, above the fixture stats —
a **Clear** button appear in the Capture panel header, and a stack of result panels:

- **Result · Identification** — titled with the item the model read (e.g. *Laptop
  motherboard*), with a stamp on the right and fields **Brand · Class · CPCB category ·
  Mass estimate**, plus chips for the condition, an **N units** chip if it counted more
  than one, a *Hazardous fraction present* chip if it saw one, and an *NN% confidence*
  chip.
- **A material assay table** captioned *"Material assay, priced against the EcoEPR rate
  card"*, with columns **Material · Grade · Mass · Rate · Value · Handling**. Every row
  is a real rate-card line. Hazardous/inert lines show `—` for rate and value, because
  they carry a disposal cost, not a payout.
- **Result · Payout** — titled *What the collector is offered*, with fields **Gross
  material value · Handling fee (shown as `− ₹…`) · Net to collector · EPR credit**.
  Under the fields: the credit note id, the rate basis, and *Valid until …*.
- **Result · Gatekeeper** (or **Result · Gatekeeper · R-0x** when a rule fired) — titled
  with the matched class, holding the reason sentence, the signals it read, and a
  confidence meter.
- **Provenance** — titled *What produced this*, with badges `Foundry · gpt-4.1-mini`,
  the latency (e.g. `1.2 s`), the inputs it used (`photo`, `photo + text`, `voice`, …),
  and the call timestamp. Any warning (a clamped mass, a declared-mass disagreement) is
  listed here with a leading `—`.

### 2.4 Check the arithmetic

- [ ] **net = gross − handling.** Read the three numbers off the Payout panel and confirm
      they add up. Do it by hand; this is the one number the system is judged on.
- [ ] Every assay row shows a rate from the rate card, and `Value = Mass × Rate` at that
      rate (₹/kg, so grams ÷ 1000).
- [ ] The EPR credit reads a figure, or **None issued** when the item was rejected.

### 2.5 Reset

Click **Clear** in the Capture panel header to empty the form between runs. Nothing
persists — the next submission is a fresh call.

---

## 3 · Feature #2 — Multi-Modal ID (photo + Hindi voice)

**Screen:** `/intake`. **Button:** **Read this intake**.

### 3.1 Open it

Click **New intake** in the left rail.

**You should see:** the header *Operations · Intake*, the title **New intake**, and the
Capture panel with the eyebrow *Live intake*. This panel has **no** *Declared mass* field
— the shared capture form shows it on `/valuation` only. Its groups are **1 · Photo**,
**2 · Voice note (Hindi)** and **3 · What the collector said**.

### 3.2 Capture a Hindi voice note

Either route works:

- **Record live:** click **Record** (the button relabels to **Stop recording**), grant the
  microphone when the browser asks, speak one sentence of Hindi about an e-waste item,
  then click **Stop recording**. The panel shows an *Attached* badge plus
  `voice-note.wav · N s` — the browser re-encodes the recording to 16 kHz mono WAV, the
  only audio shape Foundry reads.
- **Or attach a clip:** under **2 · Voice note (Hindi)**, choose an audio file
  (WebM/OGG/WAV/MP3/MP4, under 3 MB). It is decoded and re-encoded the same way.

Optionally add a photo under **1 · Photo** as well — the whole point is that both go in
one call.

### 3.3 Run it

Click **Read this intake**.

**You should see** a stack under the Capture panel:

- [ ] a **voice-note card** with the verbatim **Devanagari** transcript *and* an English
      translation, engine-labelled `Foundry · gpt-4.1-mini`;
- [ ] **Result · Extraction** — titled *What was pulled out* — a table where every field
      carries a confidence **and** a `photo` / `voice` source tag;
- [ ] below it, the **same priced result as feature #1**: Identification, the assay table,
      Payout, Gatekeeper and Provenance. One submission, one round trip, transcript *and*
      price.

### 3.4 The silence check (a correctness test, not a bug report)

1. Click **Clear**, then **Record**, stay silent for two seconds, and **Stop recording**.
2. Click **Read this intake**.

**You should see:** **no voice-note card** and no transcript claimed. Silence is not
speech, and `null` is the correct answer. A confident transcript about an item you never
mentioned is the failure this check exists to catch.

### 3.5 Wrong-format checks

These are the guards that run before the model is ever called:

- [ ] A photo over 3 MB is refused in the browser with a `payload_too_large` badge and
      the message naming the size.
- [ ] A photo and a clip that each pass alone but together exceed ~5.5 MB encoded are
      refused client-side, before the request leaves, with a message about sending one of
      them.
- [ ] If you deny the microphone, you get a `mic_denied` badge and the note field still
      works — you are not stuck.

---

## 4 · Feature #3 — Fraud-Prevention Vision Gatekeeper

**Screen:** `/validation`. **Button:** **Run the gatekeeper**.

### 4.1 Open it

Click **Validation queue** in the left rail.

**You should see:** the header *Operations · Validation*, the title **Validation queue**,
and the Capture panel with the eyebrow *Live gatekeeper*, whose body copy invites you to
try a plastic bottle.

### 4.2 The canonical refusal

1. Under **1 · Photo**, attach a photo of **something that is not e-waste**. A plastic
   bottle is the canonical test.
2. Click **Run the gatekeeper**.

**You should see** one panel: **Result · Gatekeeper · R-01**, titled with what it read
(e.g. *Plastic water bottle*), with a verdict mark on the right and:

- [ ] a solid headline badge reading **Not creditable**;
- [ ] fields **Matched class · CPCB category · Mass estimate · Credit withheld**, where
      the withheld figure is **None** for R-01 (a bottle has no material value);
- [ ] the reason written as a sentence a supervisor can read — *why* it is not e-waste —
      not a status code;
- [ ] a signals list and a confidence meter;
- [ ] a credit-note line and the **Provenance** block naming the model and latency.

### 4.3 The rule that is enforced in code, not asked for in the prompt

Same feature, second half. This one tests policy rather than vision.

1. Click **Clear** so the photo from 4.2 is gone (or reload `/validation`).
2. Attach **no photo**.
3. Under **3 · What the collector said**, type an e-waste description, e.g.
   `लैपटॉप मदरबोर्ड, करीब 400 ग्राम` — or plain English.
4. Click **Run the gatekeeper**.

**You should see** a verification downgraded to a hold, with no photo anywhere in the
inputs:

- [ ] the headline badge reads **Held for a human** (not *Creditable*);
- [ ] the Provenance warnings include **"Held for review: a verified outcome needs a
      photograph. A spoken or typed description alone cannot earn an automatic
      credit."**;
- [ ] a second warning reads **"No photograph was attached, so the identification rests
      on the collector's words."**;
- [ ] the inputs badge says `text` and never `photo`.

That downgrade lives in `lib/ai/analyse.ts`, not in the prompt — it is the rule that a
spoken or typed claim cannot on its own mint a credit.

> The credit field on a held item is still populated (a held item draws its scheduled
> credit once a human clears it). The headline is the verdict; the field is what the item
> is worth. *Rejected* is the only verdict that withholds entirely.

> The model may pick a different rule for a different object — **R-02** duplicate hash,
> **R-03** working device that must go to reuse, **R-04** swollen battery. The bottle
> should always come back **R-01**.

---

## 5 · Prove the gate itself

Authority is a rank; you open a screen when your rank is at least the screen's minimum.
The three AI features sit behind those same screens.

| Screen | Minimum role | Feature |
|---|---|---|
| `/` Landing | public, no login | — |
| `/dashboard` Dashboard | any of the five | — |
| `/map` Hotspot map | any of the five | — |
| `/intake` | operator | **#2** |
| `/valuation` | officer | **#1** |
| `/validation` | officer | **#3** |
| `/doc`, `/doc/features/*` | public, no login | — |

Sign out from the bottom of the left rail (on a phone it is the **Sign out** button in
the top strip), then sign in again as a lesser role and use the **address bar**:

**As `demo.viewer@example.com`:**

- [ ] the dashboard opens and the rail has shrunk to just *Dashboard* and *Hotspot map*,
      with the line *"6 screens are hidden by this role."*;
- [ ] `/map` opens (`200`);
- [ ] typing `/valuation` lands on
      `/no-access?from=%2Fvaluation&need=officer+or+above&why=insufficient-rank`, whose
      heading reads *This screen is not yours* / *"You asked for /valuation."*, whose
      notice reads *"This screen needs officer or above"*, and whose role ladder marks
      **Viewer ← you**.

**As `demo.operator@example.com`** (the sharper version of the same test):

- [ ] `/intake` opens — feature #2 is reachable;
- [ ] `/validation` is refused, and the notice names **operator or above**.

**As `demo.owner@example.com` or `demo.admin@example.com`:** everything opens and the
rail hides nothing.

A brand-new `/signup` account gets no group at all: it opens nothing, and `/no-access`
tells it *"This account has no role yet"* rather than pretending the screen is missing.
Granting a role is a Cognito console action.

---

## What "working" means

If all three features pass, these three invariants should hold on every result card:

- **The model never prints a rupee figure.** It returns item classes, material ids with
  masses, and a verdict. Every price is computed on the server from the rate card in
  [`lib/data/rate-card.ts`](../lib/data/rate-card.ts). If money appears, the server made
  it — that is the point.
- **Zero and empty are legitimate.** A bottle has no material value (the withheld credit
  reads `None`); silence has no transcript (`null`). Neither is a bug.
- **Every answer names its model.** The Provenance block carries the model id and the
  latency, and a fallback adds a visible warning naming the model that answered instead —
  a substitution is never silent.

The model id on the badge comes from `AZURE_OPENAI_DEPLOYMENT` (currently `gpt-4.1-mini`),
the name of the deployment created on the Microsoft Foundry resource.

---

## When something goes wrong

| What you see | Code | Means |
|---|---|---|
| "Live analysis off" | `ai_unavailable` (503) | `AZURE_OPENAI_ENDPOINT` or `AZURE_OPENAI_API_KEY` is missing; the screen falls back to sample data |
| the deployment has no quota | `ai_credits` (402) | the deployment behind `AZURE_OPENAI_DEPLOYMENT` is over quota or unentitled; raise quota in the portal, or re-run `scripts/foundry-setup.sh` for a model with available quota |
| the key was not accepted | `ai_key_rejected` (401/403) | `AZURE_OPENAI_API_KEY` is wrong or disabled for this resource |
| the deployment is gone | `ai_model_missing` (404) | `AZURE_OPENAI_DEPLOYMENT` names a deployment that does not exist on this resource |
| the deployment is busy | `ai_at_capacity` (502) | the deployment was rate-limited — retry |
| the Hindi voice note fails | `ai_call_failed` (400) | the deployment has no audio input (this build's `gpt-4.1-mini` does not); an audio-capable deployment is required |
| provider refused / timed out | `ai_call_failed` (502) | the call failed for a reason none of the above names |
| reply outside the closed vocabulary | `ai_reply_invalid` (422) | discarded, nothing credited; `issues[]` names each offence |
| upload rejected | `payload_too_large` (413) | over 3 MB a file, or ~5.5 MB combined |
| upload rejected | `unsupported_media` (415) | mime type not in the accepted list |
| nothing attached and nothing typed | `empty_request` (400) | the button is disabled for this, so you should not reach it |
| declared mass over 200 kg | `bad_request` (400) | the server caps declared mass |
| nothing happens when you press the button | — | the button is disabled until there is a photo, a clip or a note |
| the browser will not record | `no_recorder` / `mic_denied` | the mic is unavailable or was refused; attach a clip instead |
| the request never arrived | `network` | the browser could not reach the server; nothing was credited |
| bounced to `/login` | `unauthorized` (401) | session ended (sessions last one hour) — sign in again, you come back to the page |
| bounced to `/no-access` | `forbidden` (403) | this role does not open that screen for real, not just in the rail |
| the API refused a foreign page | `cross_origin` (403) | the three AI endpoints accept same-origin POSTs only |

Those last few are worth exercising deliberately: the AI routes re-check the role
themselves, so a viewer can be refused *by the endpoint* (`403 forbidden`) even if the
page never rendered, and a POST from another origin is refused outright.

---

## Feature write-ups

The long-form arguments — the ranking, the fraud controls, why vernacular voice matters —
are public at `/doc/features/*`, and
[`free-options-features-1-3.md`](free-options-features-1-3.md) covers what each feature
can run on for free.
