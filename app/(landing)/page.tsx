import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";

import { LoopTrace } from "@/components/motion/loop-trace";
import { RateTicker } from "@/components/motion/rate-ticker";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { Receipt, type ReceiptLine } from "@/components/ui/receipt";
import { Stamp } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { coreLoopSlugs, getFeature } from "@/lib/data/features";
import { focusItemId, getItem } from "@/lib/data/inventory";
import { intakeStats } from "@/lib/data/intake";
import { logisticsStats } from "@/lib/data/operations";
import { RATE_CARD, type MaterialId } from "@/lib/data/rate-card";
import { SIMULATED_CLAIM } from "@/lib/disclaimer";
import { formatInr, formatMass, formatPct, formatRate, lineValue } from "@/lib/format";
import { materialLabel, materialTone, verdictLabel } from "@/lib/tone";
import type { FeatureSlug } from "@/lib/types";

export const metadata: Metadata = {
  title: "EcoEPR — Prove it went to a licensed recycler",
  description:
    "India generates 3.2M tonnes of e-waste a year and over 90% moves through informal collectors. EcoEPR turns a photo or a Hindi voice note into a metal assay, a server-computed rate and an EPR credit note — routed only to CPCB-registered recyclers.",
};

/*
  The landing page is plain type on paper.

  It is the brand surface, so it wears the warmer bone ground (app/(landing)/landing.css)
  and nothing else: no cards, no shadows, no panels, no decorative motion. A section is a
  mono eyebrow, a display line, a paragraph, and a hairline where the section ends. The one
  framed object on the page is the receipt, because the receipt is the thing the product
  exists to produce.

  Seven content blocks, in one argument: **the problem** (the scale of the flow, and the
  three things that break in it), **the proof** (the receipt), **how it works** (the three
  instruments and the one rule that keeps them honest), **the loop** (the four screens,
  photographed as they run), **the stack**, the honesty clause, and the way in.

  The problem leads because the receipt means nothing until the reader knows why it is
  worth having, and nothing is explained twice: the valuation rule is stated once, in the
  third block, with the rate card collapsed behind a toggle rather than dumped on the page.
*/

const item = getItem(focusItemId);
const coreLoop = coreLoopSlugs.map(getFeature);
const { valuation, gatekeeper } = item;

/** The same receipt the valuation screen renders, built from the real rate card. */
const receiptLines: ReceiptLine[] = item.materials.map((line) => {
  const value = lineValue(line.massGrams, line.ratePerKg);
  return {
    label: `${line.name} (${line.symbol})`,
    detail:
      value > 0
        ? `${formatMass(line.massGrams)} @ ${formatRate(line.ratePerKg)}`
        : line.handling,
    value: value > 0 ? formatInr(value) : "—",
    muted: value === 0,
  };
});

/** The three instruments the item passes: what it is, what it is worth, whether it clears. */
const bench = [
  {
    index: "01",
    name: "Assay",
    title: "Assay by mass",
    body: "Six fractions, weighed line by line. The item's mass is the exact sum of its lines, so the total on the receipt can never drift from the parts above it.",
    figure: formatMass(item.massGrams),
    note: `${item.materials.length} fractions · ${item.hazards.length ? "hazard line present" : "no hazard line"}`,
  },
  {
    index: "02",
    name: "Rate",
    title: "Priced on the server",            body: "The per-class handling tariff is subtracted here, on this side of the wire, where an auditor can re-run it line by line rather than trusting a figure a model produced.",
    figure: `${formatInr(valuation.grossValue)} − ${formatInr(valuation.handlingFee)}`,
    note: `Net ${formatInr(valuation.netToCollector)} to the collector`,
  },
  {
    index: "03",
    name: "Gate",
    title: "Read before payout",
    body: "Valid or invalid on every upload, before a rupee is promised. A rejected submission names the rule it broke rather than guessing at what it might be.",
    figure: formatPct(gatekeeper.confidence),
    note: `${verdictLabel(gatekeeper.verdict)} · ${gatekeeper.matchedClass}`,
  },
];

/** The three failures, rendered inside block 01 rather than as a block of their own. */
const gaps = [
  {
    title: "The collection is invisible",
    body: "Over 90% of e-waste is bought by informal collectors. Nothing is geotagged, weighed or receipted, so the tonnage never reaches a compliance file.",
  },
  {
    title: "Any photo can claim a credit",
    body: "Without a gate in front of payout, a picture of a plastic bottle earns the same note as a laptop mainboard. That is a gameable system, not a compliance system.",
  },
  {
    title: "Rates rest on trust",
    body: "Ask a language model for a scrap price and it invents a rupee figure no auditor can reconstruct. A valuation you cannot check line by line is theatre.",
  },
];

const claims = [
  `${SIMULATED_CLAIM} That is exactly why the gatekeeper exists.`,
  "We route to CPCB-registered recyclers; we do not process waste ourselves.",
  "WhatsApp is the next channel, not part of this build — the same pipeline, different transport.",
];

/** A handful of real rate-card lines, so the page shows rates rather than asserting them. */
const showcaseRates: MaterialId[] = ["cu", "al", "au", "pb", "li"];

/**
 * The four loop screens as they were actually running, captured with a signed-in session by
 * `npm run shots` (scripts/landing-shots.mjs). A screen is the one thing no paragraph can
 * stand in for, and a judge cannot sign in from a slide.
 */
const loopShots: { slug: FeatureSlug; src: string; alt: string }[] = [
  {
    slug: "intake",
    src: "/shots/01-intake.jpg",
    alt: "The New intake screen: the capture console beside a photographed mainboard and its identified material fractions, each with a mass estimate and a confidence.",
  },
  {
    slug: "valuation",
    src: "/shots/02-valuation.jpg",
    alt: "The Valuations screen: the priced-item queue above the metal breakdown of one item and its net figure to the collector.",
  },
  {
    slug: "gatekeeper",
    src: "/shots/03-validation.jpg",
    alt: "The Validation queue: submissions waiting on a human, each with the rule it broke and the evidence behind the hold.",
  },
  {
    slug: "pickup",
    src: "/shots/04-pickups.jpg",
    alt: "The Pickups screen: loads with their routed facility, stream, weight and settlement state.",
  },
];

/**
 * Built on AWS, and named. Every line here is a service the code calls — the same list
 * lib/data/features.ts carries per capability — and the one thing that is not AWS is said
 * out loud rather than folded into the badge.
 */
const awsStack = [
  {
    name: "Amazon Cognito",
    role: "Who you are: the password, the groups and the session cookie this page signs in with. The app never stores a password of its own.",
  },
  {
    name: "Amazon RDS",
    role: "PostgreSQL, and the ledger: items, valuations, decisions and rate cards. Every read answers \"not configured\" rather than guessing when it is absent.",
  },
  {
    name: "Amazon S3",
    role: "The media archive: the collector's photograph and voice note, written under a key scoped to media/* and read back through the app, never a public URL.",
  },
  {
    name: "Amazon DynamoDB",
    role: "The load board, the recycler directory and the credit notes — with DynamoDB Streams as the trigger that settles a load.",
  },
  {
    name: "AWS Lambda",
    role: "One function serves the pickup API; a second consumes the stream and pays out once per settled load, never twice.",
  },
  {
    name: "Amazon API Gateway",
    role: "The front door to that API, with a Cognito JWT authorizer in front of every route.",
  },
  {
    name: "AWS Amplify Hosting",
    role: "Where this page is served from: SSR on Lambda, and the request ceiling that shapes what a model call can promise.",
  },
];

/** The marker that opens an eyebrow, and the numbering the page's spine runs on. */
function Eyebrow({ label, center = false }: { label: string; center?: boolean }) {
  return (
    <p
      className={`flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-ink-muted ${
        center ? "justify-center" : ""
      }`}
    >
      <span aria-hidden className="size-2 shrink-0 bg-copper" />
      {label}
    </p>
  );
}

/** One numbered band: eyebrow, display line, lede, then whatever the band has to show. */
function Band({
  id,
  index,
  name,
  title,
  lede,
  children,
}: {
  id: string;
  index: string;
  name: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-rule">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <header className="max-w-3xl">
          <Eyebrow label={`${index} / ${name}`} />
          <h2
            data-motion="scan"
            className="mt-5 font-display text-[clamp(2rem,4.4vw,3.25rem)] uppercase leading-[0.95] tracking-tight"
          >
            {title}
          </h2>
          {lede ? (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">{lede}</p>
          ) : null}
        </header>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="relative flex flex-col">
      {/* ------------------------------------------------------------- hero */}
      <section className="border-b border-rule">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <Eyebrow label="Brand EPR compliance · Mumbai + Pune pilot" center />

          {/* One line solid, one line struck as an outline: the second line is the claim,
              the first is only the run-up to it. */}
          <h1 className="mx-auto mt-7 max-w-4xl font-display text-[clamp(2.75rem,8.4vw,6.5rem)] uppercase leading-[0.92] tracking-tight">
            Prove it went to a
            <br />
            <span className="display-outline">licensed recycler.</span>
          </h1>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-ink-soft">
            India generates 3.2 million tonnes of e-waste a year and over 90% of it moves
            through informal collectors — no safety protocol, no paper trail. EcoEPR turns a
            photo or a Hindi voice note into a metal assay, a rate computed on the server,
            and an EPR credit note stamped at a CPCB-registered recycler.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/dashboard">Open the app</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Sign in
            </ButtonLink>
          </div>

          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            The working screens need an account
          </p>
        </div>
      </section>

      <RateTicker />

      {/* ------------------------------------------------------ the problem */}
      {/* The scale and the three failures are one block, because they are one argument: the
          obligation is large, and there are three specific reasons it cannot be met today.
          Splitting them put the solution on screen before the problem it answers. */}
      <Band
        id="problem"
        index="01"
        name="The problem"
        title="A legal mandate with no paper trail."
        lede="A brand carries an EPR obligation from CPCB and no reliable way to prove it was met. India generates 3.2 million tonnes of e-waste a year and over 90% of it moves through informal collectors — and three things break between that doorstep and the compliance file."
      >
        <StatGrid columns={4}>
          <Stat
            label="E-waste generated"
            value="3.2M"
            unit="tonnes / year"
            note="National annual volume. Over 90% is handled informally."
          />
          <Stat
            label="Handled informally"
            value="90%"
            unit="of the flow"
            note="Collected without a safety protocol and without a paper trail."
          />
          <Stat
            label="Hazardous share"
            value={formatPct(logisticsStats.hazardousShare)}
            unit="of pilot pickups"
            note="Batteries, leaded glass and capacitor banks on a licensed route."
          />
          <Stat
            label="Median settlement"
            value={logisticsStats.medianSettleHours.toFixed(1)}
            unit="hours"
            emphasis
            note="From doorstep valuation to a settled credit note."
          />
        </StatGrid>

        {/* A ledger, not a card wall: three independent failures, so nothing is numbered. */}
        <ul data-motion="rows" className="mt-14 border-t border-rule">
          {gaps.map((gap) => (
            <li
              key={gap.title}
              className="grid gap-x-10 gap-y-2 border-b border-rule py-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
            >
              <h3 className="flex items-start gap-3 font-display text-xl uppercase leading-tight tracking-tight">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-copper" />
                {gap.title}
              </h3>
              <p className="text-[15px] leading-relaxed text-ink-soft">{gap.body}</p>
            </li>
          ))}
        </ul>
      </Band>

      {/* -------------------------------------------------------- the artefact */}
      {/* The one framed object on the page, because it is the one object the product
          produces. It follows the problem for that reason: the numbers above are what give
          it a job — over 90% of the flow leaves no paper trail — and every band below it is
          either the assay and the rate card it is derived from, or why it can be trusted.
          Proof needs a question before it means anything. */}
      <section id="artefact" className="scroll-mt-24 border-b border-rule">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <Eyebrow label="The artefact" center />
            <div className="mt-8">
              <Receipt
                title="Scrap rate receipt"
                reference={item.id}
                issuedAt="Issued 09 Oct 2026, 14:25 IST"
                lines={receiptLines}
                adjustments={[
                  {
                    label: "Handling & licensed line fee",
                    value: `−${formatInr(valuation.handlingFee)}`,
                  },
                ]}
                total={{
                  label: "Net to collector",
                  value: formatInr(valuation.netToCollector),
                  sub: `Valid until ${valuation.validUntil}`,
                }}
                note="Every figure is derived from the assay and the rate card below. Nothing is issued until the gatekeeper reads Verified."
                stamp={<Stamp verdict={gatekeeper.verdict} />}
              />
            </div>
            <p className="mt-6 text-center text-[13px] leading-relaxed text-ink-muted">
              The one artefact a compliance officer can hold: a note that names the item, the
              rate and the recycler.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- how it works */}
      {/* The bench and the rule were two blocks making one point twice: what the three
          instruments measure, and the single constraint that makes the money they produce
          checkable. One block, said once, with the rate card itself collapsed behind a
          toggle — a dense table nobody reads twice is noise, not evidence. */}
      <Band
        id="how"
        index="02"
        name="How it works"
        title="One item, three instruments."
        lede={`Assay, rate, gate — the path one submission takes. Every figure belongs to ${item.id}, the same item the receipt above prices; none of it is an average.`}
      >
        <ul data-motion="rows" className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {bench.map((instrument) => (
            <li key={instrument.name} className="border-t border-rule pt-5">
              <p className="flex items-baseline gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                <span className="text-copper">{instrument.index}</span>
                {instrument.name}
              </p>
              <h3 className="mt-4 font-display text-2xl uppercase leading-tight tracking-tight sm:text-3xl">
                {instrument.title}
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{instrument.body}</p>
              <p className="mt-5 font-mono text-[14px] tabular-nums text-ink">
                {instrument.figure}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-ink-muted">
                {instrument.note}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-14 grid gap-10 border-t border-rule pt-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h3 className="font-display text-2xl uppercase leading-tight tracking-tight sm:text-3xl">
              The model never states a rupee figure.
            </h3>
            <p className="mt-4 text-base leading-relaxed text-ink-soft">
              Microsoft Foundry reads the photograph and the Hindi voice note in a single call
              and returns vocabulary: an item class from a closed list, material ids with mass
              estimates, a verdict and a confidence. A reply whose ids or verdict fall outside
              those closed lists is discarded rather than guessed at, and no priced figure is
              ever among what comes back. Every rupee on this page is arithmetic on this side
              of the wire, against a published schedule.
            </p>

            <FieldList columns={1} className="mt-8">
              <Field label="Gross material value" value={formatInr(valuation.grossValue)} mono />
              <Field
                label="Handling & licensed line fee"
                value={`−${formatInr(valuation.handlingFee)}`}
                mono
              />
              <Field
                label="Net to collector"
                value={formatInr(valuation.netToCollector)}
                mono
                tone="copper"
              />
            </FieldList>

            <p className="mt-6 text-[15px] leading-relaxed text-ink-muted">
              The handling fee is a per-class tariff, not a function of weight, so a light
              submission of a dear class can cost more to route than it yields. The collector
              is never shown a negative offer — the shortfall is the operator&apos;s cost, not
              a debt owed by the person in the lane.
            </p>
          </div>

          <div>
            <details className="border-t border-rule pt-4">
              <summary className="cursor-pointer font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-ink underline decoration-rule underline-offset-[6px] transition-colors hover:decoration-copper">
                See the rate card
              </summary>
              <div className="mt-6">
                <Table caption="EcoEPR rate card · representative lines">
                  <THead>
                    <TR>
                      <TH>Material</TH>
                      <TH>Class</TH>
                      <TH numeric>Rate</TH>
                      <TH className="hidden sm:table-cell">Handling</TH>
                    </TR>
                  </THead>
                  <TBody data-motion="rows">
                    {showcaseRates.map((id) => {
                      const line = RATE_CARD[id];
                      return (
                        <TR key={id}>
                          <TD>
                            <span className="font-medium">{line.name}</span>
                            <span className="ml-2 font-mono text-[11px] text-ink-muted">
                              {line.symbol}
                            </span>
                          </TD>
                          <TD>
                            <Badge tone={materialTone(line.category)}>
                              {materialLabel(line.category)}
                            </Badge>
                          </TD>
                          <TD numeric mono>
                            {line.ratePerKg > 0 ? formatRate(line.ratePerKg) : "—"}
                          </TD>
                          <TD className="hidden text-[12px] text-ink-muted sm:table-cell">
                            {line.handling}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                <p className="mt-5 text-[14px] leading-relaxed text-ink-muted">
                  Hazardous and inert fractions carry a rate of zero and a handling note
                  instead of a value, because they are a disposal cost rather than a payout.
                  Rates here are a labelled demo card; replacing them with a licensed feed
                  moves nothing else.
                </p>
              </div>
            </details>
          </div>
        </div>
      </Band>

      {/* ------------------------------------------------------- the loop */}
      <Band
        id="loop"
        index="03"
        name="The loop"
        title="One item, four screens."
        lede="Numbered because it is a real sequence: nothing is promised to the collector until step 03 clears the item. The four screens below are photographs of the running app with a session signed in, not mock-ups — npm run shots takes them again on demand."
      >
        <LoopTrace>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {coreLoop.map((feature, index) => (
              <li key={feature.slug} className="pt-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-copper">
                  Step {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 font-display text-xl uppercase leading-tight tracking-tight">
                  {feature.name}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                  {feature.tagline}
                </p>
              </li>
            ))}
          </ol>
        </LoopTrace>

        <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
          The gatekeeper sits after valuation and before anything is promised, so a credit is
          only minted once the item clears the valid/invalid boolean. {formatPct(intakeStats.voiceShare)}{" "}
          of intakes arrive as a Hindi voice note rather than a photo.
        </p>

        {/* The screens themselves. A judge cannot sign in from a slide, so the evidence is
            the pixel: each of these is the running screen, captured with a session signed in
            (scripts/landing-shots.mjs). The link opens the full-size file, because a 1440px
            screen in a two-column grid is legible at a glance and not much further. */}
        <ul data-motion="rows" className="mt-14 grid gap-8 border-t border-rule pt-10 sm:grid-cols-2">
          {loopShots.map((shot) => {
            const feature = getFeature(shot.slug);
            return (
              <li key={shot.slug}>
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  width={1440}
                  height={900}
                  sizes="(min-width: 640px) 46vw, 100vw"
                  className="block w-full border border-rule bg-paper-raised"
                />
                <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  <span className="text-ink">{feature.productName}</span>
                  <span className="tabular-nums">{feature.productHref}</span>
                  <a
                    href={shot.src}
                    className="ml-auto underline decoration-rule underline-offset-4 hover:decoration-copper"
                  >
                    Full size
                  </a>
                </p>
              </li>
            );
          })}
        </ul>
      </Band>

      {/* ------------------------------------------------------------ the stack */}
      {/* An explicit judging criterion, so it is a block and not a footnote. Named services
          only, and the one part of the pipeline that is not AWS is named too: a strip that
          claimed a logo it does not use would undo the honesty clause below it. */}
      <section id="stack" className="scroll-mt-24 border-b border-rule">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <Eyebrow label="Built on AWS" />
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink-soft">
            Seven services, each doing the one thing it is good at. The identification model is
            Microsoft Foundry, which is not AWS — it reads the photograph and the Hindi audio
            in a single call, and it is named here rather than folded into the badge.
          </p>
          <ul data-motion="rows" className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {awsStack.map((service) => (
              <li key={service.name} className="border-t border-rule pt-4">
                <h3 className="font-display text-lg uppercase leading-tight tracking-tight">
                  {service.name}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{service.role}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------------- honesty */}
      <Band
        id="honesty"
        index="04"
        name="Honesty clause"
        title="What we are not claiming."
        lede="A prototype that survives a demo is one that says where its edges are before someone finds them."
      >
        <ul data-motion="rows" className="flex max-w-3xl flex-col gap-4">
          {claims.map((claim) => (
            <li key={claim} className="flex gap-3 text-[15px] leading-relaxed">
              <span aria-hidden className="mt-2.5 size-2 shrink-0 bg-copper" />
              <span className="text-ink-soft">{claim}</span>
            </li>
          ))}
        </ul>
      </Band>

      {/* ------------------------------------------------------------- cta */}
      <section className="bg-ink text-paper">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <p className="flex items-center justify-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-paper/60">
            <span aria-hidden className="size-2 shrink-0 bg-copper" />
            Start here
          </p>
          <h2
            data-motion="scan"
            className="mx-auto mt-6 max-w-3xl font-display text-[clamp(2.25rem,5.6vw,4.25rem)] uppercase leading-[0.95] tracking-tight"
          >
            Open the working screens.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-paper/70">
            Intake, valuation, the gatekeeper and pickup routing all run against a live
            multimodal model. Sign in with a demo account to work the queue.
          </p>
          <div className="mt-9 flex justify-center">
            <ButtonLink href="/dashboard" variant="inverse">
              Open the app
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
