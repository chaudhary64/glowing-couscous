import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { MeterRow } from "@/components/ui/meter";
import { formatInr } from "@/lib/format";
import { collectorTierLabel, collectorTierTone } from "@/lib/tone";
import type { Collector } from "@/lib/types";

/**
 * The roster. Ordered by credits earned, with a totals row, because a directory
 * of five collectors is still a ledger and the totals have to be checkable.
 */
export function CollectorDirectory({ collectors }: { collectors: Collector[] }) {
  const sorted = [...collectors].sort((a, b) => b.creditsInr - a.creditsInr);
  const totalPickups = sorted.reduce((sum, collector) => sum + collector.pickups, 0);
  const totalCredits = sorted.reduce((sum, collector) => sum + collector.creditsInr, 0);

  return (
    <Surface>
      <Table caption={`${sorted.length} collectors on the platform, ordered by credits earned`}>
        <THead>
          <TR>
            <TH>Collector</TH>
            <TH className="hidden sm:table-cell">City</TH>
            <TH>Standing</TH>
            <TH className="hidden lg:table-cell">Languages spoken</TH>
            <TH numeric>Pickups</TH>
            <TH numeric>Credits</TH>
            <TH numeric className="hidden sm:table-cell">
              Per pickup
            </TH>
          </TR>
        </THead>
        <TBody>
          {sorted.map((collector) => (
            <TR key={collector.id}>
              <TD>
                <span className="font-medium">{collector.name}</span>
                <p className="mt-1 font-mono text-[11px] text-ink-muted">
                  {collector.id}
                </p>
              </TD>
              <TD className="hidden text-ink-soft sm:table-cell">{collector.city}</TD>
              <TD>
                <Badge tone={collectorTierTone(collector.tier)}>
                  {collectorTierLabel(collector.tier)}
                </Badge>
              </TD>
              <TD className="hidden lg:table-cell">
                <span className="flex flex-wrap gap-1.5">
                  {collector.languages.map((language) => (
                    <Badge key={language} tone="neutral">
                      {language}
                    </Badge>
                  ))}
                </span>
              </TD>
              <TD numeric mono>
                {collector.pickups}
              </TD>
              <TD numeric mono>
                {formatInr(collector.creditsInr)}
              </TD>
              <TD numeric mono className="hidden sm:table-cell">
                {formatInr(Math.round(collector.creditsInr / collector.pickups))}
              </TD>
            </TR>
          ))}
          <TR className="border-t-2 border-ink bg-paper">
            <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              All collectors
            </TD>
            <TD className="hidden sm:table-cell" />
            <TD />
            <TD className="hidden lg:table-cell" />
            <TD numeric mono className="font-semibold">
              {totalPickups.toLocaleString("en-IN")}
            </TD>
            <TD numeric mono className="font-semibold">
              {formatInr(totalCredits)}
            </TD>
            <TD numeric mono className="hidden font-semibold sm:table-cell">
              {formatInr(Math.round(totalCredits / totalPickups))}
            </TD>
          </TR>
        </TBody>
      </Table>
    </Surface>
  );
}

/**
 * Credits split across the roster. Relative to the leading collector rather than
 * to the total, because the question an operator asks is who is carrying the
 * volume, not what share the tail holds.
 */
export function CreditsShare({ collectors }: { collectors: Collector[] }) {
  const sorted = [...collectors].sort((a, b) => b.creditsInr - a.creditsInr);
  const top = sorted[0].creditsInr;
  const total = sorted.reduce((sum, collector) => sum + collector.creditsInr, 0);

  return (
    <div className="flex flex-col">
      {sorted.map((collector) => (
        <MeterRow
          key={collector.id}
          label={collector.name}
          value={collector.creditsInr / top}
          tone={collectorTierTone(collector.tier)}
          display={formatInr(collector.creditsInr)}
          note={`${collector.pickups} pickups · ${collector.tier} · ${
            Math.round((collector.creditsInr / total) * 100)
          }% of all credits`}
        />
      ))}
    </div>
  );
}
