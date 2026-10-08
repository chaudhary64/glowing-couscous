import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { channels } from "@/lib/data/channels";
import { channelLabel, channelTone } from "@/lib/tone";
import type { Channel } from "@/lib/types";

const statusOrder: Record<Channel["status"], number> = {
  shipped: 0,
  next: 1,
  deferred: 2,
};

/**
 * Ordered shipped → next → deferred. Within a group the fixture order is kept, so
 * WhatsApp lands last — which is the whole point of this table.
 */
export function ChannelTable() {
  const ordered = [...channels].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status],
  );

  return (
    <Surface className="mt-4">
      <Table caption="Delivery order, not commitment dates. WhatsApp is last by design.">
        <THead>
          <TR>
            <TH>Channel</TH>
            <TH>Rank</TH>
            <TH>Status</TH>
            <TH className="hidden lg:table-cell">Why it sits here</TH>
            <TH className="hidden xl:table-cell">Effort &amp; reach</TH>
          </TR>
        </THead>
        <TBody>
          {ordered.map((channel) => (
            <TR key={channel.id}>
              <TD>
                <span className="font-medium">{channel.name}</span>
                {channel.blockers.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {channel.blockers.map((blocker) => (
                      <li
                        key={blocker}
                        className="font-mono text-[11px] leading-snug text-ink-muted"
                      >
                        · {blocker}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </TD>
              <TD mono numeric className="text-copper">
                {channel.rank === null ? "—" : String(channel.rank).padStart(2, "0")}
              </TD>
              <TD>
                <Badge tone={channelTone(channel.status)}>
                  {channelLabel(channel.status)}
                </Badge>
              </TD>
              <TD className="hidden max-w-md text-[12px] leading-snug text-ink-soft lg:table-cell">
                {channel.why}
              </TD>
              <TD className="hidden xl:table-cell">
                <span className="font-mono text-[12px] text-ink">{channel.effort}</span>
                <p className="mt-1 max-w-xs text-[12px] leading-snug text-ink-muted">
                  {channel.reach}
                </p>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Surface>
  );
}
