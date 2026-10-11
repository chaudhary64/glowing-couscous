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
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getCurrentUser } from "@/lib/auth/dal";
import { cn } from "@/lib/cn";
import { coreLoopSlugs, getFeature } from "@/lib/data/features";
import { landingEntry } from "@/lib/data/landing";
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
  and nothing else: no cards, no shadows, no panels, no decorative motion. A band is a
  mono eyebrow, a display line, a paragraph, and a hairline where the band ends. The one
  framed object on the page is the receipt, because the receipt is the thing the product
  exists to produce.

  The composition of the bands is borrowed whole from the Stivio landing page captured in
  site-reaper/downloaded-site. Four moves, each kept in this brand's hand:

  - **An argument is a rail and a body.** The eyebrow, the display line and the lede sit
    in a sticky left rail; everything the band has to show sits to their right. As the
    reader scrolls a body, its opening claim stays on screen — the reader never has to
    remember which section they are in. The receipt above and the stack below are the two
    deliberate exceptions, because they are the two objects, not two claims.
  - **An instrument is a readout.** Each of the three steps on the bench is a framed
    panel holding the artefact that step actually produces — the mass ledger, the
    arithmetic, the verdict — with the words that explain it underneath.
  - **A list is a grid of hairlines.** The stack is named in a hairline grid rather than a
    paragraph, because a claim about seven services is evidence only when you can count
    them.
  - **A boundary is a ruled row.** The honesty clause is an accordion: each row names a
    limit in the summary, and the detail expands beneath it.

  Numbering is kept because the page genuinely is an argument in order: the problem first,
  because a receipt means nothing until the reader knows why it is worth having. Nothing is
  explained twice — the valuation rule is stated once, in the second band, with the rate
  card collapsed behind a toggle rather than dumped on the page.
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

/** The three failures, rendered inside band 01 rather than as a band of their own. */
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

/*
  The honesty clause, as boundaries rather than a list of disclaimers: the summary states
  the limit, the detail explains why the product is still worth having. The first row is
  open on load, because a limit a reader has to click to find is not an honest limit.
*/
const boundaries = [
  {
    title: "We are not moving money.",
    body: `${SIMULATED_CLAIM} The gatekeeper that reads every upload is real; the rupee it guards is not.`,
  },
  {
    title: "We are not processing the waste.",
    body: "We route to CPCB-registered recyclers; we do not process waste ourselves. The licensed line, the certificate and the audit are theirs — our job is the chain of evidence that gets a submission there.",
  },
  {
    title: "WhatsApp is not in this build.",
    body: "WhatsApp is the next channel, not part of this build — the same pipeline, different transport. Today the intake is the console and the Hindi voice note.",
  },
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
 * out loud in its own row rather than folded into the badge.
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

/** The marker that opens an eyebrow. */
function Eyebrow({ label, center = false }: { label: string; center?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-ink-muted",
        center && "justify-center",
      )}
    >
      <span aria-hidden className="size-2 shrink-0 bg-copper" />
      {label}
    </p>
  );
}

/**
 * One numbered band: a sticky rail carrying the claim, and the evidence to its right.
 *
 * The rail holds the eyebrow, the display line and the lede so that a reader scrolling a
 * long body — the four screens, the seven services — never loses the sentence the body is
 * an answer to. It is `self-start` because a stretched grid item has no room to stick.
 */
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
        <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12">
          <header className="lg:sticky lg:top-24 lg:self-start">
            <Eyebrow label={`${index} / ${name}`} />
            {/* Sized to the rail, not to the page: Archivo Black cannot break a word, and a
                display size that overflows its column would spill into the gap beside it. */}
            <h2
              data-motion="scan"
              className="mt-5 font-display text-[clamp(1.625rem,3vw,2.25rem)] uppercase leading-[0.95] tracking-tight"
            >
              {title}
            </h2>
            {lede ? (
              <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{lede}</p>
            ) : null}
          </header>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * One instrument on the bench: the readout it produces, framed, then the words that explain
 * it. The frame is a hairline, not a slab — the receipt is the page's one heavy edge, and a
 * wall of 3px cards would spend the page's only loud object three times over.
 */
function Instrument({
  index,
  name,
  title,
  body,
  figure,
  note,
  footer,
  artifact,
  accent = false,
}: {
  index: string;
  name: string;
  title: string;
  body: string;
  figure: string;
  note: string;
  footer: string;
  artifact: ReactNode;
  /** Copper for the figure that carries the money. */
  accent?: boolean;
}) {
  return (
    <li className="flex flex-col">
      {/* A readout, not a card wall: hairline frame, a fixed floor so the three line up, and
          the artefact pinned to the top of the frame the way a screen reads. */}
      <div className="flex h-full min-h-[19rem] flex-col border border-rule bg-paper-raised">
        <p className="flex items-baseline gap-2.5 border-b border-rule px-3.5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink-muted">
          <span className="text-copper">{index}</span>
          {name}
        </p>
        <div className="flex flex-1 flex-col px-3.5 py-4">{artifact}</div>
        <p className="border-t border-rule px-3.5 py-2.5 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-ink-muted">
          {footer}
        </p>
      </div>

      <h3 className="mt-4 font-display text-xl uppercase leading-tight tracking-tight">
        {title}
      </h3>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{body}</p>
      <p className={cn("mt-4 font-mono text-[14px] tabular-nums", accent ? "text-copper" : "text-ink")}>
        {figure}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-ink-muted">
        {note}
      </p>
    </li>
  );
}

export default async function LandingPage() {
  /*
    The hero and the closing band are the two other places this page offers a way in, and
    they read the same pair the header and footer do (lib/data/landing.ts). A guest gets
    "Sign in" — the working screens need an account — and someone already holding a
    session gets "Open the app" rather than a second invitation to sign in they cannot use.
  */
  const user = await getCurrentUser();
  const entry = landingEntry(user !== null);

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
            <ButtonLink href={entry.primary.href}>{entry.primary.label}</ButtonLink>
            {entry.secondary ? (
              <ButtonLink href={entry.secondary.href} variant="secondary">
                {entry.secondary.label}
              </ButtonLink>
            ) : null}
          </div>

          {entry.secondary ? (
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              The working screens need an account
            </p>
          ) : null}
        </div>
      </section>

      <RateTicker />

      {/* ------------------------------------------------------ the problem */}
      {/* The scale and the three failures are one band, because they are one argument: the
          obligation is large, and there are three specific reasons it cannot be met today.
          Splitting them put the solution on screen before the problem it answers. */}
      <Band
        id="problem"
        index="01"
        name="The problem"
        title="A legal mandate with no paper trail."
        lede="A brand carries an EPR obligation from CPCB and no reliable way to prove it was met. India generates 3.2 million tonnes of e-waste a year and over 90% of it moves through informal collectors — and three things break between that doorstep and the compliance file."
      >
        <StatGrid columns={2}>
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
        <ul data-motion="rows" className="mt-12 border-t border-rule">
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
          Proof needs a question before it means anything. Centred, and the only band with a
          centred heading, because it is an object rather than a claim. */}
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
      {/* The bench and the rule were two bands making one point twice: what the three
          instruments measure, and the single constraint that makes the money they produce
          checkable. One band, said once, and each instrument now shows its own readout
          rather than describing it — a panel is what the reference page's three steps
          taught, and a mass ledger and an arithmetic are things this product already
          computes. The rate card stays collapsed behind a toggle: a dense table nobody
          reads twice is noise, not evidence. */}
      <Band
        id="how"
        index="02"
        name="How it works"
        title="One item, three instruments."
        lede={`Assay, rate, gate — the path one submission takes. Every figure belongs to ${item.id}, the same item the receipt above prices; none of it is an average.`}
      >
        <ul data-motion="rows" className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
          <Instrument
            index="01"
            name="Assay"
            title="Assay by mass"
            body="Six fractions, weighed line by line. The item's mass is the exact sum of its lines, so the total on the receipt can never drift from the parts above it."
            figure={formatMass(item.massGrams)}
            note={`${item.materials.length} fractions · ${item.hazards.length ? "hazard line present" : "no hazard line"}`}
            footer="Line-by-line weights · nothing estimated"
            artifact={
              <ul className="flex flex-col">
                {item.materials.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-baseline gap-2 border-b border-dotted border-rule py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">
                      {line.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">
                      {formatMass(line.massGrams)}
                    </span>
                  </li>
                ))}
                {/* The whole point of the instrument, stated as the last line of its ledger. */}
                <li className="flex items-baseline gap-2 pt-2.5">
                  <span className="min-w-0 flex-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                    Σ Item mass
                  </span>
                  <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-ink">
                    {formatMass(item.massGrams)}
                  </span>
                </li>
              </ul>
            }
          />

          <Instrument
            index="02"
            name="Rate"
            title="Priced on the server"
            body="The per-class handling tariff is subtracted here, on this side of the wire, where an auditor can re-run it line by line rather than trusting a figure a model produced."
            figure={`${formatInr(valuation.grossValue)} − ${formatInr(valuation.handlingFee)}`}
            note={`Net ${formatInr(valuation.netToCollector)} to the collector`}
            footer="Server-side arithmetic · no model figure"
            accent
            artifact={
              <FieldList columns={1} className="gap-y-0">
                <Field
                  label="Gross material value"
                  value={formatInr(valuation.grossValue)}
                  mono
                />
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
                  className="border-t-[3px] border-ink"
                />
              </FieldList>
            }
          />

          <Instrument
            index="03"
            name="Gate"
            title="Read before payout"
            body="Valid or invalid on every upload, before a rupee is promised. A rejected submission names the rule it broke rather than guessing at what it might be."
            figure={formatPct(gatekeeper.confidence)}
            note={`${verdictLabel(gatekeeper.verdict)} · ${gatekeeper.matchedClass}`}
            footer={`${gatekeeper.modelVersion} · ${gatekeeper.checkedAt}`}
            artifact={
              <div className="flex flex-col items-start gap-4">
                <VerdictMark verdict={gatekeeper.verdict} />
                <FieldList columns={1} className="w-full gap-y-0">
                  <Field label="Matched class" value={gatekeeper.matchedClass} />
                  <Field
                    label="Confidence"
                    value={formatPct(gatekeeper.confidence)}
                    mono
                  />
                  <Field
                    label="Rule fired"
                    value={gatekeeper.ruleCode ?? "None — nothing triggered"}
                  />
                </FieldList>
              </div>
            }
          />
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
      {/* An explicit judging criterion, so it is a band and not a footnote. The heading is
          full width and the services are a hairline grid, because a claim about seven
          services is evidence only when you can count them. Named services only, and the one
          part of the pipeline that is not AWS gets its own ruled row: a strip that claimed a
          logo it does not use would undo the honesty clause below it. */}
      <section id="stack" className="scroll-mt-24 border-b border-rule">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <Eyebrow label="Built on AWS" />
          <h2
            data-motion="scan"
            className="mt-5 max-w-3xl font-display text-[clamp(2rem,4.4vw,3.25rem)] uppercase leading-[0.95] tracking-tight"
          >
            Seven services, one route.
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-soft">
            &ldquo;Runs on AWS&rdquo; is a claim; a list is the evidence. Each service below is
            one the code actually calls, doing the one thing it is good at.
          </p>

          <ul
            data-motion="rows"
            className="mt-12 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4"
          >
            {awsStack.map((service) => (
              <li key={service.name} className="border-t-[3px] border-ink pt-4">
                <h3 className="font-display text-lg uppercase leading-tight tracking-tight">
                  {service.name}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{service.role}</p>
              </li>
            ))}
          </ul>

          <p className="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-dashed border-rule pt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-ink-muted">
            <span className="text-copper">Not AWS</span>
            <span className="text-ink">Microsoft Foundry</span>
            <span className="normal-case tracking-normal">
              reads the photograph and the Hindi audio in a single call, and is named here
              rather than folded into the badge.
            </span>
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- honesty */}
      {/* A boundary a reader has to click to find is not an honest boundary, so the first
          row is open on load and every summary states its limit in full. The rule under
          each row is the same hairline the stack is ruled with; the accordion is the only
          interaction on the page. */}
      <Band
        id="honesty"
        index="04"
        name="Honesty clause"
        title="What we are not claiming."
        lede="A prototype that survives a demo is one that says where its edges are before someone finds them."
      >
        <ul data-motion="rows" className="border-t border-rule">
          {boundaries.map((boundary, index) => (
            <li key={boundary.title} className="border-b border-rule">
              <details className="group" open={index === 0}>
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                  <h3 className="font-display text-lg uppercase leading-tight tracking-tight sm:text-xl">
                    {boundary.title}
                  </h3>
                  <span
                    aria-hidden
                    className="shrink-0 font-mono text-lg leading-none text-copper"
                  >
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-ink-soft">
                  {boundary.body}
                </p>
              </details>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          The gatekeeper exists for the first boundary. A prototype that pays out on any
          photograph would be a demonstration of the problem, not of the fix.
        </p>
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
            <ButtonLink href={entry.primary.href} variant="inverse">
              {entry.primary.label}
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
