import Link from "next/link";
import {
  CollectorDirectory,
  CreditsShare,
} from "@/components/features/product/collectors/collector-directory";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { intakeStats } from "@/lib/data/intake";
import { getItem } from "@/lib/data/inventory";
import { collectors, pickups } from "@/lib/data/operations";
import { formatInr } from "@/lib/format";
import { pickupLabel, pickupTone } from "@/lib/tone";

/** Totals are derived from the roster, never typed twice. */
const totalPickups = collectors.reduce((sum, entry) => sum + entry.pickups, 0);
const totalCredits = collectors.reduce((sum, entry) => sum + entry.creditsInr, 0);
const meanPerPickup = Math.round(totalCredits / totalPickups);

const leadCount = collectors.filter((entry) => entry.tier === "lead").length;
const verifiedCount = collectors.filter((entry) => entry.tier === "verified").length;
const newCount = collectors.filter((entry) => entry.tier === "new").length;

/** Languages the pipeline supports against languages the roster actually speaks. */
const languageCounts = new Map<string, number>();
for (const collector of collectors) {
  for (const language of collector.languages) {
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }
}

const languageCoverage = [...languageCounts.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
);

/** Enabled in the pipeline but spoken by nobody on the roster yet. */
const uncoveredLanguages = intakeStats.languages.filter(
  (language) => !languageCounts.has(language),
);

/** Spoken by a collector but not yet enabled in the pipeline. */
const unsupportedLanguages = languageCoverage
  .map(([language]) => language)
  .filter((language) => !intakeStats.languages.includes(language));

/** Loads joined to the collector carrying them and the item in the load. */
const recentLoads = pickups.map((pickup) => ({
  pickup,
  collector: collectors.find((entry) => entry.id === pickup.collectorId),
  item: getItem(pickup.itemId),
}));

export default function CollectorsPage() {
  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Collectors"
        title="Collectors"
        lede={`${collectors.length} informal collectors are on the platform across Mumbai, Thane and Pune, carrying ${formatInr(totalCredits)} of simulated credits between them.`}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              Pipeline languages
            </span>
            <span className="flex flex-wrap gap-1.5">
              {intakeStats.languages.map((language) => (
                <Badge key={language} tone="copper">
                  {language}
                </Badge>
              ))}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {formatInr(meanPerPickup)} mean per pickup
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Collectors on the platform"
          value={String(collectors.length)}
          unit="people"
          note={`${leadCount} lead · ${verifiedCount} verified · ${newCount} new.`}
        />
        <Stat
          label="Credits earned"
          value={formatInr(totalCredits)}
          emphasis
          note={`Across ${totalPickups.toLocaleString("en-IN")} pickups since onboarding.`}
        />
        <Stat
          label="Mean per pickup"
          value={formatInr(meanPerPickup)}
          unit="/ pickup"
          note="Total credits divided by total pickups, so the tail is included."
        />
        <Stat
          label="Languages spoken"
          value={String(languageCoverage.length)}
          unit="on the roster"
          note={`Pipeline supports ${intakeStats.languages.length}. ${uncoveredLanguages.join(", ")} has no speaker yet, and ${unsupportedLanguages.join(", ")} is spoken but not enabled.`}
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Roster"
          title="Everyone on the platform"
          note="Standing is earned on pickup history, not typed in by an operator."
        />
        <div className="mt-5">
          <CollectorDirectory collectors={collectors} />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader
            eyebrow="Distribution"
            title="Credits share"
            note="Measured against the leading collector, so the shape of the roster is visible at a glance."
          />
          <Surface className="mt-5 p-4">
            <CreditsShare collectors={collectors} />
          </Surface>
        </section>

        <section>
          <SectionHeader
            eyebrow="Language coverage"
            title="Who can talk to whom"
            note="Reach is limited by the language a collector actually speaks, not by the list of supported ones."
          />
          <Surface className="mt-5 p-4">
            <ul className="flex flex-col">
              {languageCoverage.map(([language, speakers]) => (
                <li
                  key={language}
                  className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0"
                >
                  <span className="text-sm font-medium">{language}</span>
                  <span className="font-mono text-[13px] tabular-nums text-ink-soft">
                    {speakers} of {collectors.length} collectors
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              {uncoveredLanguages.join(", ")} is enabled in the pipeline but spoken by
              nobody on the roster, and {unsupportedLanguages.join(", ")} is spoken by a
              collector the pipeline cannot yet hear. Neither gap is engineering work:
              adding a language is a configuration change, not a new screen.
            </p>
          </Surface>
        </section>
      </div>

      <section>
        <SectionHeader
          eyebrow="Loads in flight"
          title="Recently active"
          note="Which collector is carrying which item, and what state that load is in."
        />
        <Surface className="mt-5">
          <Table>
            <THead>
              <TR>
                <TH>Load</TH>
                <TH>Collector</TH>
                <TH className="hidden sm:table-cell">Item</TH>
                <TH>Status</TH>
                <TH numeric>Settled</TH>
              </TR>
            </THead>
            <TBody>
              {recentLoads.map(({ pickup, collector, item }) => (
                <TR
                  key={pickup.id}
                  className={pickup.hazardous ? "border-l-4 border-l-hazard" : undefined}
                >
                  <TD mono>
                    <Link
                      href="/pickups"
                      className="font-medium underline decoration-rule underline-offset-2 hover:decoration-copper"
                    >
                      {pickup.id}
                    </Link>
                    {pickup.hazardous ? (
                      <p className="mt-1">
                        <Badge tone="hazard">Hazard</Badge>
                      </p>
                    ) : null}
                  </TD>
                  <TD>
                    {collector ? collector.name : "Unassigned"}
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">
                      {collector ? collector.id : pickup.collectorId}
                    </p>
                  </TD>
                  <TD className="hidden text-[13px] text-ink-soft sm:table-cell">
                    {item.label}
                  </TD>
                  <TD>
                    <Badge tone={pickupTone(pickup.status)}>
                      {pickupLabel(pickup.status)}
                    </Badge>
                  </TD>
                  <TD numeric mono>
                    {pickup.settledInr > 0 ? formatInr(pickup.settledInr) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
            A settled row means the credit note was issued against weight verified at
            the recycler gate. A withheld row means a rule blocked the payout while the
            item still left the street.
          </p>
        </Surface>
      </section>

      <Panel eyebrow="Read this before quoting a number" title="Simulated credits">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          Every figure on this screen is a fixture. Credits are simulated, and each one
          is tied to a weighed load at a CPCB-registered recycler rather than to a
          promise made at the doorstep — which is the only reason a brand could book it
          against an EPR mandate.
        </p>
      </Panel>
    </div>
  );
}
