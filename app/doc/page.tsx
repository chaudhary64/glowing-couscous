import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { coreLoopSlugs, features, featuresByRank, getFeature } from "@/lib/data/features";
import { intakeStats } from "@/lib/data/intake";
import { logisticsStats } from "@/lib/data/operations";
import { featureStatusTone } from "@/lib/tone";

const claims = [
  "Credits are simulated. This is not a payout system, which is exactly why the gatekeeper exists.",
  "We route to CPCB-registered recyclers; we do not process waste ourselves.",
  "WhatsApp is the next channel, not part of this build.",
];

export default function DocIndexPage() {
  const coreLoop = coreLoopSlugs.map(getFeature);

  return (
    <div className="flex flex-col gap-12">
      <header className="border-b-2 border-ink pb-8">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
          Feature documentation · Track 03 · Waste &amp; Energy
        </p>
        <h1 className="mt-4 max-w-4xl font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-6xl">
          The formal route, priced at the doorstep.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
          Six capabilities, ranked. Each write-up says what the feature does, why
          it holds its rank, and which working screen delivers it. A photo or a
          Hindi voice note goes in; a metal assay, a rupee figure and a brand EPR
          credit come out, and a licensed recycler takes the hazardous part off the
          street.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ButtonLink href="/intake">Open the intake screen</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Back to the app
          </ButtonLink>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            {features.length} capabilities · {coreLoop.length} in the core loop
          </span>
        </div>
      </header>

      <section>
        <SectionHeader
          eyebrow="The problem, in fixture numbers"
          title="What the pilot already measured"
        />
        <StatGrid columns={4} className="mt-6">
          <Stat
            label="E-waste generated"
            value="3.2M"
            unit="tonnes / year"
            note="National annual volume, over 90% handled informally."
          />
          <Stat
            label="Informal collectors"
            value="1.5M"
            unit="people"
            note="Working without safety protocol or a compliance paper trail."
          />
          <Stat
            label="Hazardous share"
            value="41%"
            unit="of pilot pickups"
            note="Batteries, leaded glass and capacitor banks needing a licensed route."
          />
          <Stat
            label="Median settlement"
            value={logisticsStats.medianSettleHours.toFixed(1)}
            unit="hours"
            note={`${logisticsStats.notesIssued} credit notes issued at ₹${logisticsStats.creditsIssuedInr.toLocaleString("en-IN")} across ${intakeStats.today} intakes today.`}
          />
        </StatGrid>
      </section>

      <section id="ladder">
        <SectionHeader
          eyebrow="Priority ladder"
          title="Ranked highest to lowest"
          note="Ranked on whether the AI does real work, whether it survives a live demo, and whether it defends the EPR claim."
        />

        <Surface className="mt-5">
          <Table>
            <THead>
              <TR>
                <TH className="w-14">Rank</TH>
                <TH>Capability</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Why it sits here</TH>
                <TH className="hidden sm:table-cell">Working screen</TH>
              </TR>
            </THead>
            <TBody>
              {featuresByRank.map((feature) => (
                <TR key={feature.slug}>
                  <TD mono numeric className="font-display text-lg text-copper">
                    {String(feature.rank).padStart(2, "0")}
                  </TD>
                  <TD>
                    <Link
                      href={feature.docHref}
                      className="font-medium text-ink underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                    >
                      {feature.name}
                    </Link>
                    <p className="mt-1 max-w-sm text-[12px] leading-snug text-ink-muted">
                      {feature.tagline}
                    </p>
                  </TD>
                  <TD>
                    <Badge tone={featureStatusTone(feature.status)}>
                      {feature.status === "deferred"
                        ? "Deferred"
                        : feature.status === "supporting"
                          ? "Supporting"
                          : "Core"}
                    </Badge>
                  </TD>
                  <TD className="hidden max-w-md text-[12px] leading-snug text-ink-soft lg:table-cell">
                    {feature.proof}
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {feature.productHref ? (
                      <Link
                        href={feature.productHref}
                        className="font-mono text-[11px] uppercase tracking-[0.12em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                      >
                        {feature.productName} →
                      </Link>
                    ) : (
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                        No screen yet
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Surface>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          Rank 6 is last on purpose. A WhatsApp bot re-transports the voice intake
          that already ships in-app: more integration risk, no new intelligence.{" "}
          <Link
            href="/doc/features/roadmap"
            className="underline decoration-rule underline-offset-2 hover:decoration-copper"
          >
            The full argument
          </Link>
          .
        </p>
      </section>

      <section>
        <SectionHeader
          eyebrow="One item, four screens"
          title="How the core loop runs"
        />
        <ol className="mt-6 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {coreLoop.map((feature, index) => (
            <li key={feature.slug} className="bg-paper-raised p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">
                Step {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-display text-base uppercase leading-tight tracking-tight">
                <Link href={feature.docHref} className="hover:text-copper">
                  {feature.name}
                </Link>
              </h3>
              <p className="mt-2 text-[12px] leading-snug text-ink-soft">
                {feature.pageJob}
              </p>
              {feature.productHref ? (
                <Link
                  href={feature.productHref}
                  className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                >
                  {feature.productName} →
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          The gatekeeper sits after valuation but before anything is promised to a
          collector: a credit is only minted once the item clears the valid/invalid
          boolean. Heatmapping reads the same pickup stream afterwards.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
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

        <Panel eyebrow="Build it / Ship it" title="Stack">
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                Build it
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                PartyRock for fast multimodal prompt iteration, SAM CLI for local
                serverless execution.
              </p>
            </div>
            <div className="border-t border-rule pt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                Ship it
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  "Amazon Bedrock (Claude 3.5 Sonnet, multimodal)",
                  "Amazon Transcribe (Hindi)",
                  "API Gateway + Lambda",
                  "DynamoDB",
                  "OpenSearch (local)",
                  "Next.js",
                ].map((service) => (
                  <li key={service}>
                    <Badge tone="neutral">{service}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
