import type { Metadata } from "next";
import Link from "next/link";

import { AssaySequence, type AssayFacts } from "@/components/features/landing/assay-sequence";
import { HeroBoard } from "@/components/features/landing/hero-board";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { SectionHeader } from "@/components/ui/page-header";
import { Receipt, type ReceiptLine } from "@/components/ui/receipt";
import { Stamp } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { coreLoopSlugs, getFeature } from "@/lib/data/features";
import { focusItemId, getItem } from "@/lib/data/inventory";
import { intakeStats } from "@/lib/data/intake";
import { logisticsStats } from "@/lib/data/operations";
import { RATE_CARD, type MaterialId } from "@/lib/data/rate-card";
import { formatInr, formatMass, formatPct, formatRate, lineValue } from "@/lib/format";
import { materialLabel, materialTone } from "@/lib/tone";

export const metadata: Metadata = {
  title: "EcoEPR — Prove it went to a licensed recycler",
  description:
    "India generates 3.2M tonnes of e-waste a year and over 90% moves through informal collectors. EcoEPR turns a photo or a Hindi voice note into a metal assay, a server-computed rate and an EPR credit note — routed only to CPCB-registered recyclers.",
};

/*
  The landing page is written for the brand that carries the EPR obligation, not for
  the operator who works the queue. Its thesis is the receipt: the one artefact that
  proves a unit reached a licensed recycler. Everything below the hero exists to make
  that artefact credible — where the number comes from, what the gate blocks, and what
  this project does not claim.
*/

const item = getItem(focusItemId);
const coreLoop = coreLoopSlugs.map(getFeature);

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

/** The scroll sequence's captions: the same item, the same rate card, as the receipt. */
const assayFacts: AssayFacts = {
  itemId: item.id,
  itemLabel: item.label,
  city: item.city,
  matchedClass: item.gatekeeper.matchedClass,
  confidence: formatPct(item.gatekeeper.confidence),
  fractions: [...item.materials]
    .sort((a, b) => b.massGrams - a.massGrams)
    .map((line) => ({
      name: /^[A-Z][a-z]?$/.test(line.symbol) ? `${line.name} (${line.symbol})` : line.name,
      mass: formatMass(line.massGrams),
    })),
  totalMass: formatMass(item.massGrams),
  lines: receiptLines.filter((line) => !line.muted),
  gross: formatInr(item.valuation.grossValue),
  fee: formatInr(item.valuation.handlingFee),
  net: formatInr(item.valuation.netToCollector),
  validUntil: item.valuation.validUntil,
};

/** A handful of real rate-card lines, so the page shows rates rather than asserting them. */
const showcaseRates: MaterialId[] = ["cu", "al", "au", "pb", "li"];

/** What breaks today, each mapped to the capability that closes it. */
const gaps = [
  {
    title: "The collection is invisible",
    body: "Over 90% of e-waste is bought by informal collectors. Nothing is geotagged, weighed or receipted, so the tonnage never reaches a compliance file.",
    href: "/doc/features/intake" as const,
    linkLabel: "Multi-modal identification",
  },
  {
    title: "Any photo can claim a credit",
    body: "Without a gate in front of payout, a picture of a plastic bottle earns the same note as a laptop mainboard. That is a gameable system, not a compliance system.",
    href: "/doc/features/gatekeeper" as const,
    linkLabel: "Fraud-prevention gatekeeper",
  },
  {
    title: "Rates rest on trust",
    body: "Ask a language model for a scrap price and it invents a rupee figure no auditor can reconstruct. A valuation you cannot check line by line is theatre.",
    href: "/doc/features/valuation" as const,
    linkLabel: "Metal & EPR valuation",
  },
];

const claims = [
  "Credits are simulated. This is not a payout system, which is exactly why the gatekeeper exists.",
  "We route to CPCB-registered recyclers; we do not process waste ourselves.",
  "WhatsApp is the next channel, not part of this build — the same pipeline, different transport.",
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* ------------------------------------------------------------- hero */}
      {/*
        Ink ground, continuing the header: the gatekeeper's eye. The board sits behind the
        content and a veil keeps the headline legible over it; without WebGL the section
        is exactly this ground and nothing is missing.
      */}
      <section className="relative isolate overflow-hidden border-b-2 border-ink bg-ink text-paper">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,var(--color-ink)_0%,var(--color-ink)_34%,color-mix(in_oklab,var(--color-ink)_90%,transparent)_46%,color-mix(in_oklab,var(--color-ink)_45%,transparent)_58%,transparent_70%)] lg:block"
        />
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 lg:min-h-[calc(100dvh-56px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-12 lg:py-20">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
              Brand EPR compliance · Mumbai + Pune pilot
            </p>

            <h1 className="mt-4 font-display text-5xl uppercase leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">
              Prove it went to a licensed recycler.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-paper/75">
              India generates 3.2 million tonnes of e-waste a year, and over 90% of it
              moves through informal collectors — no safety protocol, no paper trail.
              EcoEPR gives the kabadiwala a Hindi voice-note intake and gives you the
              audit chain: a metal assay, a rate computed on the server, and an EPR
              credit note stamped at a CPCB-registered recycler.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ButtonLink
                href="/dashboard"
                className="border-copper! bg-copper! text-paper! hover:border-paper! hover:bg-paper! hover:text-ink!"
              >
                Open the app
              </ButtonLink>
              <ButtonLink
                href="/doc"
                variant="secondary"
                className="border-paper/40! bg-transparent! text-paper! hover:border-paper! hover:bg-paper! hover:text-ink!"
              >
                Read the feature write-ups
              </ButtonLink>
            </div>

            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/50">
              Documentation is public · the working screens need an account
            </p>
          </div>

          {/*
            One board, two compositions: on a phone it is a block between the copy and
            the receipt, its edges dissolving into the ink; on a desktop it lies behind
            everything, under the veil.
          */}
          <HeroBoard className="relative -mx-5 -my-4 h-[86vw] max-h-[520px] min-h-[300px] [mask-image:linear-gradient(180deg,transparent,#000_16%,#000_80%,transparent)] sm:-mx-8 lg:absolute lg:inset-0 lg:left-[18%] lg:-z-20 lg:m-0 lg:h-auto lg:[mask-image:none]" />

          <div className="relative z-10 min-w-0 max-lg:-mt-10 lg:pl-8">
            {/* Paper on the bench: the receipt keeps its own ink colour on the dark ground. */}
            <div className="text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]">
            <Receipt
              title="Scrap rate receipt"
              reference={item.id}
              issuedAt="Issued 09 Oct 2026, 14:25 IST"
              lines={receiptLines}
              adjustments={[
                {
                  label: "Handling & licensed line fee",
                  value: `−${formatInr(item.valuation.handlingFee)}`,
                },
              ]}
              total={{
                label: "Net to collector",
                value: formatInr(item.valuation.netToCollector),
                sub: `Valid until ${item.valuation.validUntil}`,
              }}
              note="Every figure is derived from the assay above and the rate card below. Nothing is issued until the gatekeeper reads Verified."
              stamp={<Stamp verdict={item.gatekeeper.verdict} />}
            />
            </div>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/50">
              The one artefact a compliance officer can hold: a note that names the item,
              the rate and the recycler.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- the assay, in 3D */}
      <AssaySequence facts={assayFacts} stamp={<Stamp verdict={item.gatekeeper.verdict} angle={-8} />} />

      {/* ------------------------------------------------------ the numbers */}
      <section className="border-b-2 border-ink bg-paper-raised">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
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
        </div>
      </section>

      {/* ---------------------------------------------------------- the gap */}
      <section id="gap" className="scroll-mt-24 border-b-2 border-ink">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
          <SectionHeader
            eyebrow="The gap"
            title="The mandate is legal. The paper trail is not."
            note="A brand carries an EPR obligation from CPCB and no reliable way to prove it was met. Three things break between the doorstep and the compliance file."
          />

          <ul className="mt-6 grid gap-px border border-rule bg-rule md:grid-cols-3">
            {gaps.map((gap) => (
              <li key={gap.title} className="flex flex-col bg-paper-raised p-5">
                <span aria-hidden className="size-2.5 bg-copper" />
                <h3 className="mt-3 font-display text-lg uppercase leading-tight tracking-tight">
                  {gap.title}
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">
                  {gap.body}
                </p>
                <Link
                  href={gap.href}
                  className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                >
                  {gap.linkLabel} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------- the loop */}
      <section id="how" className="scroll-mt-24 border-b-2 border-ink bg-paper-raised">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
          <SectionHeader
            eyebrow="The core loop"
            title="One item, four screens."
            note="Numbered because it is a real sequence: nothing is promised to the collector until step 03 clears the item."
          />

          <ol className="mt-6 grid gap-px border border-rule bg-rule md:grid-cols-2 lg:grid-cols-4">
            {coreLoop.map((feature, index) => (
              <li key={feature.slug} className="flex flex-col bg-paper-raised p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">
                  Step {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 font-display text-lg uppercase leading-tight tracking-tight">
                  {feature.name}
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-snug text-ink-soft">
                  {feature.tagline}
                </p>
                <Link
                  href={feature.docHref}
                  className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                >
                  Read the write-up →
                </Link>
              </li>
            ))}
          </ol>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
            The gatekeeper sits after valuation and before anything is promised to a
            collector, so a credit is only minted once the item clears the valid/invalid
            boolean. {formatPct(intakeStats.voiceShare)} of intakes arrive as a Hindi
            voice note rather than a photo.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------- why it holds up */}
      <section id="proof" className="scroll-mt-24 border-b-2 border-ink">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
          <SectionHeader
            eyebrow="Why it survives an audit"
            title="The model never states a rupee figure."
            note="The identification model returns vocabulary, not money. Every priced figure is arithmetic on this side of the wire."
          />

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="flex flex-col gap-6">
              <p className="text-base leading-relaxed text-ink-soft">
                The model reads the photograph and the Hindi voice note in a single
                call and returns three things: an item class from a closed list, material
                ids with mass estimates, and a verdict with a confidence. A reply whose
                ids or verdict fall outside those closed lists is discarded rather than
                guessed at — a rejected submission names the rule it broke.
              </p>

              <Panel eyebrow="The rule" title="Net = gross − handling">
                <FieldList columns={1}>
                  <Field
                    label="Gross material value"
                    value={formatInr(item.valuation.grossValue)}
                    mono
                  />
                  <Field
                    label="Handling & licensed line fee"
                    value={`−${formatInr(item.valuation.handlingFee)}`}
                    mono
                  />
                  <Field
                    label="Net to collector"
                    value={formatInr(item.valuation.netToCollector)}
                    mono
                    tone="copper"
                  />
                </FieldList>
                <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
                  The handling fee is a per-class tariff, not a function of weight, so a
                  light submission of a dear class can cost more to route than it yields.
                  The collector is never shown a negative offer — the shortfall is the
                  operator&apos;s cost, not a debt owed by the person in the lane.
                </p>
              </Panel>
            </div>

            <div>
              <Surface>
                <Table caption="EcoEPR rate card · representative lines">
                  <THead>
                    <TR>
                      <TH>Material</TH>
                      <TH>Class</TH>
                      <TH numeric>Rate</TH>
                      <TH className="hidden sm:table-cell">Handling</TH>
                    </TR>
                  </THead>
                  <TBody>
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
              </Surface>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                Hazardous and inert fractions carry a rate of zero and a handling note
                instead of a value, because they are a disposal cost rather than a payout.
                Rates here are a labelled demo card; replacing them with a licensed feed
                moves nothing else.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- honesty */}
      <section className="border-b-2 border-ink bg-paper-raised">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
          <Panel eyebrow="Honesty clause" title="What we are not claiming">
            <ul className="flex flex-col gap-3">
              {claims.map((claim) => (
                <li key={claim} className="flex gap-3 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-2 shrink-0 bg-copper" />
                  <span className="text-ink-soft">{claim}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      {/* ------------------------------------------------------------- cta */}
      <section className="bg-ink text-paper">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
            Start here
          </p>
          <h2 className="mt-3 max-w-3xl font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-5xl">
            Open the working screens.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-paper/70">
            Intake, valuation, the gatekeeper and pickup routing all run against a live
            multimodal model. Sign in with a demo account to work the queue, or read the
            write-ups first — they are public.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="/dashboard" variant="inverse">
              Open the app
            </ButtonLink>
            <Link
              href="/doc"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper underline decoration-paper/40 underline-offset-4 hover:decoration-copper"
            >
              Read the documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
