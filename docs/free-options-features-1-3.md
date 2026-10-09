# Free options for features 1–3

Investigation for **Environmental Hacks** (Bharat Builds Tour stop 02, 8–11 Oct 2026,
track *Waste & Energy*). Scope: the three AI features ranked in
[`ecoepr-track03.md`](ecoepr-track03.md) — **#1 AI Metal & EPR Valuation**, **#2
Multi-Modal ID (photo + Hindi voice)**, **#3 Fraud-Prevention Vision Gatekeeper** — and
what they can run on for free.

Verified against the event rules, the AWS free tier, and the provider docs on 9 Oct
2026. Prices and free limits move; re-check before you rely on a number.

> **Update (10 Oct 2026):** the pipeline has since moved off Gemini onto **Microsoft
> Foundry (Azure)** — see [`../lib/ai/foundry.ts`](../lib/ai/foundry.ts) and
> [`../scripts/foundry-setup.sh`](../scripts/foundry-setup.sh). On the Azure for
> Students subscription the permitted regions and per-model quotas admit only a
> vision/text deployment (`gpt-4.1-mini` in `koreacentral`), so no audio-capable model
> (the `gpt-audio` family) and no Whisper can be deployed; the Hindi voice note is instead
> transcribed by Azure Speech and its transcript goes to the model. This document is kept
> as the reasoning that led there.

---

## TL;DR

1. **Bedrock is not really blocked by model access — it is blocked at the account
   level, and the likely cause is a payment method.** A paused UPI autopay mandate
   blocks *every* Bedrock invocation account-wide, including Amazon Nova, even at $0
   spend. That matches this account's symptom exactly (`NOT_AUTHORIZED` on Nova, and
   the Anthropic FTU form itself returning "not authorized"). Fix the payment method
   and Bedrock is free to use on the credits.
2. **Bedrock + Amazon Nova is the best free option** because the $200 new-account
   credits and the ₹/$ hackathon credits (Environmental Hacks gives **$25**) are
   *credit-eligible* for Bedrock, and it satisfies the "must use AWS" rule outright.
   Nova also skips the Anthropic first-time-use form that is blocking this account.
3. **If Bedrock stays blocked, there is a free, AWS-endorsed open-source path:** run
   the model locally through **Strands Agents SDK + Ollama**. The official tour blog
   endorses exactly this ("AWS open source… runs on your own laptop") and the same
   Strands code points at Bedrock with no rewrite.
4. **Amazon Transcribe (Hindi `hi-IN`) is free for the voice feature** — 60 min/month
   for 12 months — and the block is specific to Bedrock, so this is the one AWS AI
   service the account should be able to use today (verify with one CLI call).
5. **Keep the current Gemini path** as the fallback; it already works, costs nothing on
   the free tier, and the repo's provider seam makes it a one-file swap. But do not
   make it the only thing in the demo — the rules say AWS must be *shown*, not just
   named.

---

## The constraint that decides everything

From the tour [rules](https://www.wemakedevs.org/aws/env/rules) and the
[event announcement](https://www.wemakedevs.org/blogs/announcing-environmental-hacks):

- **"Your project has to use AWS, and your demo video has to show it. Naming AWS in
  the writeup alone is not enough."**
- **"Using an AWS open source project or AWS services is mandatory to win a prize."**
- Judging: does it fix a real environmental problem · what changes for the people ·
  whether it works · whether someone outside the team could use it · the 3-minute video.
- Old projects do not count. Everything is judged from the repo and the video only —
  there is no live demo, so if a free service is not visible on screen it does not count.

**Free budget available:**

| Source | Amount | Notes |
|---|---|---|
| New AWS account free tier | up to **$200** ($100 on signup + $100 for exploring) | free plan, ~6 months |
| Environmental Hacks credits | **$25** | on top of free tier |
| AWS Builder Center student rewards | up to **$30** credits + $449 Skill Builder + $100 cert voucher | needs SheerID verification |
| Always-free AWS services | Lambda, API Gateway, DynamoDB, S3, Cognito, … | 30+ services, monthly limits |

So the running total is **~$255 in credits** — enough to run a multimodal demo on
Bedrock's cheapest models essentially for free.

---

## Why Bedrock is blocked, and the free fix

The repo already has a support case in
[`bedrock-support-case.md`](../bedrock-support-case.md) that frames this as *model
access authorization*. The evidence online points somewhere else:

- The identical error — `ValidationException: Operation not allowed`, with
  `authorizationStatus: NOT_AUTHORIZED` even for **Amazon Nova** — is a documented
  *account-level* block, not IAM, not model access, not Region.
- AWS re:Post answers on new-account Bedrock blocks list the usual suspects and add the
  decisive one: **"Your AWS account must have a valid payment method configured for AWS
  Marketplace purchases"**, and new accounts have temporary restrictions until the
  payment method is fully verified.
- A builder with the *exact* error, debugging on AWS Builder Center, found: **"our
  account also had a paused UPI autopay mandate, which blocks Bedrock invocation
  account-wide regardless of which model you're calling. AWS wants a valid payment
  method on file, even if you're spending zero dollars. We ended up switching AWS
  accounts and re-enabling billing to get past it."**
  ([NeuroBridge writeup](https://builder.aws.com/content/3JYYvEyOgU3Wpb28gCUdIdXMWzc/neurobridge-helping-neurodivergent-people-practice-difficult-conversations-with-ai-on-aws))

The support case says the account was created 2026-10-08 (one day old) and paid via a
plan with ~$159 credits. A one-day-old Indian account on a UPI mandate is precisely the
profile that hits this block. **The free fix is billing, not a support ticket:**

1. **Replace the UPI autopay mandate with a working international-eligible card**, or
   re-enable the mandate so it is not *paused*. Bedrock will not invoke account-wide
   while the payment method is invalid or paused — regardless of credits.
2. **Use Amazon Nova, not Anthropic.** Nova is first-party and needs **no first-time-use
   form**. The FTU form is what returns "your account is not authorized to perform this
   action" for Claude — that message is about the *form*, not about your IAM.
3. **Call Nova by its inference-profile id, not the foundation-model ARN.** On-demand
   throughput is rejected for the plain model id; the error is
   `Invocation of model ID … with on-demand throughput isn't supported`. Use the profile,
   e.g. `global.amazon.nova-2-lite-v1:0` (or the `apac.`/`us.` profile for the Region).
4. **Enable access in the Region you call.** Model access is per Region; `ap-south-1`
   is a supported Region.
5. If the account will not cooperate, **a fresh account with a card and re-enabled
   billing** is the documented escape hatch — and a new account brings its own $200.

> Action for the support case: it currently asks AWS to *authorize model access*. If the
> real cause is the payment method, that request is aimed at the wrong thing and will
> bounce. Test step 1 first (10 minutes) before waiting on the ticket.

---

## Feature-by-feature free options

### #1 — AI Metal & EPR Valuation (image in → assay + price out)

| Option | Free allowance | On AWS? | Fit |
|---|---|---|---|
| **Amazon Bedrock · Amazon Nova Lite/Pro** (multimodal) | covered by ~$255 credits; Nova Lite ≈ $0.06/M in | **Yes** | **Recommended.** Native image input, first-party, no FTU form |
| **Ollama (e.g. `llama3.2-vision`) via Strands Agents SDK** | free, runs on your laptop | **Yes — AWS open source** | Best fallback: offline, no key, same Strands code swaps to Bedrock |
| Google Gemini (current) | free tier, daily RPD | No | Works today; keep as fallback, not as the only path |
| Groq · Llama 4 Scout/Maverick (vision) | free tier, ~30 RPM / 1,000 RPD | No | Fastest third-party vision |
| Cloudflare Workers AI · Llama 3.2 11B Vision | 10,000 Neurons/day | No | Good free tier, no card |
| Amazon Rekognition `DetectLabels` | **1,000 images/mo × 12 months** | **Yes** | Labels only — no reasoning or pricing; use as a *deterministic pre-pass*, not the valuator |

### #2 — Multi-Modal ID (photo + Hindi voice)

| Option | Free allowance | On AWS? | Fit |
|---|---|---|---|
| **Amazon Transcribe, `hi-IN`** (batch or streaming) | **60 min/month × 12 months** | **Yes** | **Recommended for the voice half.** Enough for a demo many times over |
| **Amazon Nova audio / Nova Sonic** (speech in the same call) | credits | **Yes** | One call for photo + voice, if Nova audio is available in-region |
| Ollama Whisper / `faster-whisper` locally via Strands | free | **Yes — AWS OSS SDK** | Offline Hindi STT, no quota |
| Google Gemini native audio (current) | free tier | No | One call, already wired |
| Groq · Whisper Large v3 (Hindi) | **2,000 req/day, 7,200 audio-sec/hr** | No | Strong free STT |
| Cloudflare Workers AI · `whisper-large-v3-turbo` | 10,000 Neurons/day | No | Free, edge-hosted |

### #3 — Fraud-Prevention Vision Gatekeeper (valid / held / rejected)

| Option | Free allowance | On AWS? | Fit |
|---|---|---|---|
| **Same vision model + closed-list rules + server-side policy** (current design) | already free | — | Cheapest and most defensible; the rule that "a spoken claim cannot mint a credit" already lives in `lib/ai/analyse.ts` |
| **Cedar** (AWS open-source policy language) for the gate rules | free, runs in-process | **Yes — AWS open source** | Excellent demo: `forbid` beats `permit`, denial explains itself with an `@id` label |
| Amazon Rekognition `DetectLabels` / `DetectModerationLabels` | 1,000 images/mo × 12 months | **Yes** | Deterministic visual pre-filter before the model sees the item |
| A small classifier on Lambda (ONNX / TorchScript in a container) | Lambda always-free (1M req + 400k GB-s/mo) | **Yes** | Strong "ML rigor" slide (precision/F1/ROC-AUC) — but requires training time you may not have on the clock |

---

## The free AWS surface you can show without Bedrock

Even if Bedrock never comes back, these are **always-free** and demonstrate real AWS:

- **AWS open source projects** (explicitly endorsed by the tour): **Strands Agents
  SDK**, **Cedar**, **OpenSearch**, **SAM CLI**, **LocalStack**, Firecracker, Corretto.
  LocalStack + SAM let you build the deployed architecture on the laptop with the same
  APIs.
- **Always-free services**: Lambda (1M req + 400k GB-s/mo), API Gateway (1M calls/mo),
  DynamoDB (25 GB), S3, Cognito, CloudWatch, SNS/SQS, EventBridge, Step Functions,
  Amplify Hosting.
- This repo **already** shows AWS through Cognito (auth, JWKS), RDS Postgres, Secrets
  Manager and Amplify Hosting — so the "must use AWS" rule is met on paper today. The
  gap is that the *AI*, which is the interesting part, is Gemini. Closing that gap is
  what this document is about.

---

## Finding (9 Oct 2026): the tier comes from the *key*, not the model

Probing this account's key against `models.list` turned up the reason the "already
works, free" assumption in point 5 above does not hold as stated:

- Every model on the first key — `gemini-3.8-flash`, the 3.x flash/lite family,
  `gemini-flash-latest`, even the open `gemma-4` ones — answers
  **`402 RESOURCE_EXHAUSTED: Your prepayment credits are depleted`**.
- That key belongs to AI Studio project `gen-lang-client-0142626254`
  (**Tier 1 · Prepay · No credits**). Credits are a *project* property, so no model id
  rescues it: the 402 is about the project's balance, not the model.
- The account's other project, `gen-lang-client-0818308399`, is **Free tier** — a key
  from *that* project is the thing that makes Gemini free here.
- Two ids are also simply retired: `gemini-2.5-flash` and `gemini-2.5-flash-lite`
  answer `404 NOT_FOUND: no longer available to new users`, pointing at
  `gemini-3.8-flash` and `gemini-3.5-flash-lite` respectively.

The code now defaults to `GEMINI_MODEL=gemini-3.5-flash-lite` (cheapest lite id, most
free-tier headroom) with `GEMINI_FALLBACK_MODEL=gemini-3.8-flash`. **The remaining step
is operational, not code:** put a key from the free-tier project in `.env.local`.

---


**Primary — Bedrock Nova (once billing is fixed) → Gemini fallback (already the code's
design).** The provider seam in [`lib/ai/gemini.ts`](../lib/ai/gemini.ts) means the
Bedrock swap is one file; keep the existing `fallbackFrom` behaviour so the substitute is
never silent on screen.

**Fallback — Strands Agents SDK + Ollama (vision + Whisper) locally, presented as the
"model-agnostic, swaps to Bedrock" story.** Same prompts, same schemas, no vendor
rewrite. This *is* an AWS open-source project, so it satisfies the rule on its own.

**Add on top, for free and for the video:**
- **Transcribe `hi-IN`** for the Hindi voice note — an unmistakably AWS AI service doing
  real work, visible in the demo.
- **Cedar** for the gatekeeper policy — a policy file where `forbid` beats `permit`, with
  a named denial reason.
- **Rekognition `DetectLabels`** as a deterministic pre-filter before the model, so the
  gatekeeper is not purely a prompt.
- **LocalStack / SAM** to run the deployed shape locally, so the architecture you show
  is the architecture you would ship.

The existing server-side design (model returns closed-list ids and a verdict; **the
server computes every rupee** from `lib/data/rate-card.ts`) means none of this changes
the trust boundary. Only the transport moves.

---

## Do this today (checklist)

- [ ] **Fix the payment method** (replace the UPI autopay mandate, or un-pause it).
      Highest-leverage 10 minutes in this document.
- [ ] **Test Nova by inference-profile id** from the CLI:
      `aws bedrock-runtime converse --model-id global.amazon.nova-2-lite-v1:0 …`.
      If this returns text, Bedrock is unblocked and the whole problem is solved for free.
- [ ] If it still fails, **run Strands + Ollama locally** and show that in the demo
      video instead — it counts as AWS open source.
- [ ] **Wire Transcribe `hi-IN`** for the voice half; it works in this account today and
      is free for 60 min/month.
- [ ] **Add Cedar** for the gatekeeper rules and screenshot the denial reason.
- [ ] In the writeup, **name the free tier and the credits** and cite the exact model
      that answered (the app already surfaces the model id on screen).
- [ ] Update [`bedrock-support-case.md`](../bedrock-support-case.md) to add the
      payment-method finding, or it will keep asking for the wrong remedy.

---

## Sources

- Environmental Hacks — rules, overview, announcement, and the two AWS Builder Center
  how-to posts (open-source stack, serverless stack): `wemakedevs.org/aws/env`,
  `/aws/env/rules`, `/blogs/announcing-environmental-hacks`,
  `/blogs/how-to-build-a-real-data-ai-project-on-the-aws-open-source-stack` (Strands,
  Cedar, OpenSearch, SAM CLI, LocalStack, Ollama).
- AWS re:Post — *New AWS Account · Bedrock Models · Operation not allowed* (payment
  method requirement; model access is per-Region).
- AWS re:Post Knowledge Center — *Resolve validation exception errors* (Anthropic FTU
  form and account-level restrictions are not code/IAM problems).
- AWS Builder Center — *NeuroBridge* (paused UPI autopay mandate blocks Bedrock
  account-wide; Nova needs the inference-profile id, not the model ARN).
- AWS pricing pages: [Bedrock](https://aws.amazon.com/bedrock/pricing/),
  [Nova](https://aws.amazon.com/nova/pricing/),
  [Transcribe](https://aws.amazon.com/transcribe/pricing/) (60 min/mo × 12 months),
  [Rekognition](https://aws.amazon.com/rekognition/pricing/) (1,000 images/mo × 12
  months), [Free Tier](https://aws.amazon.com/free/).
- Provider free tiers: Gemini API rate limits, Groq (Whisper 2,000 req/day · 7,200
  audio-sec/hr; Llama 4 vision), Cloudflare Workers AI (10,000 Neurons/day —
  Llama 3.2 11B Vision, `whisper-large-v3-turbo`), OpenRouter `:free` models.
