import Link from "next/link";
import { ChannelTable } from "@/components/features/roadmap/channel-table";
import { WhatsAppVerdict } from "@/components/features/roadmap/whatsapp-verdict";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { MetaRow, PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { channels } from "@/lib/data/channels";
import { getFeature } from "@/lib/data/features";
import { channelLabel, channelTone } from "@/lib/tone";
import type { Channel } from "@/lib/types";

export default function RoadmapPage() {
  const feature = getFeature("roadmap");

  const shipped = channels.filter((channel) => channel.status === "shipped");
  const nextChannels = channels.filter((channel) => channel.status === "next");
  const deferred = channels.filter((channel) => channel.status === "deferred");

  const whatsapp =
    channels.find((channel) => channel.id === "whatsapp") ??
    channels[channels.length - 1];

  const rungs: { title: string; status: Channel["status"]; note: string }[] = [
    {
      title: shipped.map((channel) => channel.name).join(" + "),
      status: "shipped",
      note: "Live today. Both run the same Gemini call — photo and Hindi audio read in one pass — which is why neither needed new model work.",
    },
    ...channels
      .filter((channel) => channel.status !== "shipped")
      .map((channel) => ({
        title: channel.name,
        status: channel.status,
        note: channel.why,
      })),
  ];

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="What ships, what follows, and what is deliberately not built today — with the reasoning a judge can argue against."
        meta={
          <MetaRow label="Stack">
            {feature.aws.map((service) => (
              <Badge key={service} tone="neutral">
                {service}
              </Badge>
            ))}
          </MetaRow>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Shipped today"
          value={String(shipped.length)}
          unit="channels"
          note="Web intake and the Hindi voice note, both on one Gemini call."
        />
        <Stat
          label="Next"
          value={String(nextChannels.length)}
          unit="channel"
          note="Low-data Android app with an offline queue."
        />
        <Stat
          label="Deferred"
          value={String(deferred.length)}
          unit="channels"
          note="Missed-call IVR first, WhatsApp last."
        />
        <Stat
          label="New intelligence from WhatsApp"
          value="None"
          emphasis
          note="Same pipeline, different plumbing. That is the whole reason it ranks 06."
        />
      </StatGrid>

      <WhatsAppVerdict />

      <section>
        <SectionHeader
          eyebrow="The argument"
          title="Why it is last, read once"
          note="Everything WhatsApp provides on top of the shipped app is reach. Nothing it provides is capability."
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Panel eyebrow="What it adds" title="Reach, not capability">
            <ul className="flex flex-col gap-3">
              {[
                "Collectors already live in WhatsApp, so there is nothing to install.",
                "A voice note is a native gesture there — the same input the in-app recorder accepts.",
                "A familiar thread gives the collector a payment history they can scroll back through.",
              ].map((point) => (
                <li key={point} className="flex gap-3 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-2 shrink-0 bg-copper" />
                  <span className="text-ink-soft">{point}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel eyebrow="What it costs" title="Moving parts that can fail live">
            <ul className="flex flex-col gap-3">
              {whatsapp.blockers.map((blocker) => (
                <li key={blocker} className="flex gap-3 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-2 shrink-0 bg-review" />
                  <span className="text-ink-soft">{blocker}</span>
                </li>
              ))}
              <li className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-review" />
                <span className="text-ink-soft">
                  A webhook or media-download failure is visible on stage, where an
                  in-app screen is not.
                </span>
              </li>
            </ul>
          </Panel>
        </div>

        <Surface className="mt-4 p-4">
          <FieldList columns={3}>
            <Field label="Model work required" value="None" mono tone="copper" />
            <Field
              label="Pipeline reused"
              value="One Gemini call (photo + audio), unchanged"
            />
            <Field
              label="Effect on collectors today"
              value="Nothing changes — the web intake already accepts a Hindi voice note"
            />
          </FieldList>
        </Surface>
      </section>

      <section>
        <SectionHeader
          eyebrow="Channels"
          title="Ordered by priority"
          note="Rank 06 appears exactly once, in the last row of this table."
        />
        <ChannelTable />
      </section>

      <section>
        <SectionHeader
          eyebrow="Sequence"
          title="What ships first"
          note="The numbering is a real order of delivery, not decoration."
        />

        <Surface className="mt-4">
          <ol>
            {rungs.map((rung, index) => (
              <li
                key={rung.title}
                className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-rule px-4 py-4 last:border-b-0"
              >
                <span className="font-mono text-[11px] tabular-nums text-copper">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 className="font-display text-base uppercase leading-tight tracking-tight">
                      {rung.title}
                    </h3>
                    <Badge tone={channelTone(rung.status)}>
                      {channelLabel(rung.status)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-[12px] leading-snug text-ink-muted">
                    {rung.note}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Surface>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          This is a delivery sequence, not a set of dates. Nothing here is a
          commitment to ship on a timeline.
        </p>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink pt-6">
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Shipped channel
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            The web intake is what a collector can use right now, and it is the
            channel the rest of the app is built around.
          </p>
        </div>
        <Link
          href="/intake"
          className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-paper hover:text-ink"
        >
          Open the shipped channel
        </Link>
      </section>
    </div>
  );
}
