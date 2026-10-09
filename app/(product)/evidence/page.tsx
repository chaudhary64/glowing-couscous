import { EvidenceViewer } from "@/components/features/evidence/evidence-viewer";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { formatBytes } from "@/lib/format";
import { archiveConfigured } from "@/lib/s3/archive";
import { listRecentMediaAssets } from "@/lib/s3/media-assets";

export const instant = false;

/**
 * The evidence behind the money.
 *
 * The archive has written every submitted photo and voice note to S3 since the
 * integration landed, under a key derived from the bytes themselves, and until this
 * screen existed nothing in the product could read one back: the only ways to see the
 * evidence a price came from were the AWS console and the CLI. That made the strongest
 * claim this project makes — a valuation a reviewer can check line by line — true in the
 * bucket and invisible on screen, and left "show me the photograph you turned away" with
 * no answer that was not a shrug. `app/api/ai/gatekeeper/route.ts` argues that sentence
 * into the design; this is where it is honoured.
 *
 * The authority is `/evidence`, which is deliberately the same rank the read API
 * requires — `guardFor` in `lib/auth/roles.ts` carries the note. A page gated more
 * loosely would render a Read button the API then refuses; gated more tightly, it would
 * hide from operators the evidence their own submissions produced.
 *
 * Two independent integrations decide what this page can show, and it says which one is
 * missing rather than rendering an empty list that looks like an empty archive: the
 * bucket (`S3_BUCKET`) is what makes a read possible at all, and `DATABASE_URL` is what
 * makes an object *findable*. Without the database the objects exist and only the record
 * of them is absent — the one failure shape where the evidence is real and unlistable.
 */
export default async function EvidencePage() {
  await requireAccess("/evidence");

  const listing = await listRecentMediaAssets(LIST_LIMIT);
  const assets = listing.assets;
  const photos = assets.filter((asset) => asset.kind === "photo").length;
  const voiceNotes = assets.length - photos;
  const listedBytes = assets.reduce(
    (total, asset) => total + (asset.byteSize ?? 0),
    0,
  );
  const attributed = assets.filter((asset) => asset.uploaderName !== null).length;
  const archive = archiveConfigured();

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Evidence"
        title="Evidence archive"
        lede="Every photo and voice note that passes through a valuation is written to object storage under a key derived from its own bytes, so the evidence outlives the request that priced it. A read is signed per request and expires within the hour."
        actions={
          <ButtonLink href="/intake" variant="secondary">
            Submit something new
          </ButtonLink>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={archive ? "verified" : "hazard"}>
              {archive ? "Bucket configured" : "Archive off"}
            </Badge>
            <Badge tone={listing.configured ? "neutral" : "hazard"}>
              {listing.configured ? "Rows recorded" : "No database"}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {attributed} of {assets.length} attributed to a user row
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Objects listed"
          value={listing.configured ? String(assets.length) : "—"}
          unit="most recent"
          note={`Newest first, bounded at ${LIST_LIMIT} so a screen cannot ask for the whole table.`}
        />
        <Stat
          label="Photos"
          value={listing.configured ? String(photos) : "—"}
          note="Stills, read back through a signed GetObject."
        />
        <Stat
          label="Voice notes"
          value={listing.configured ? String(voiceNotes) : "—"}
          note="The Hindi clips the transcript was produced from, kept as recorded."
        />
        <Stat
          label="Listed bytes"
          value={listing.configured ? formatBytes(listedBytes) : "—"}
          note="Sizes as stored. The exact byte count is what the key was derived from."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Most recent"
          title="Archived submissions"
          note="Read signs a fresh link for one object and nothing else. The bucket itself stays private, and no page or asset URL is public."
        />

        <Surface className="mt-4">
          {!listing.configured ? (
            <div className="p-4">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                This deployment has no <span className="font-mono">DATABASE_URL</span>, so
                the archive&rsquo;s rows were never recorded and there is nothing to list.
                The objects themselves are in the bucket under their keys — the bytes were
                written before the row was attempted — but finding one without its row
                means recomputing a SHA-256 by hand, which is the whole reason the row
                exists.
              </p>
            </div>
          ) : listing.error ? (
            <div className="p-4">
              <p className="max-w-3xl text-sm leading-relaxed text-hazard">
                The archive could not be listed: {listing.error}
              </p>
            </div>
          ) : assets.length === 0 ? (
            <div className="p-4">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                Nothing has been archived yet. The first submission through{" "}
                <span className="font-mono">/intake</span> writes an object and a row, and
                both appear here as soon as that request answers.
              </p>
            </div>
          ) : (
            <EvidenceViewer assets={assets} />
          )}

          <p className="border-t border-rule px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
            A read is refused outright when the archive is switched off, when the session
            does not open this screen, or when the request does not come from this app.
            Those are the API&rsquo;s decisions, not this page&rsquo;s, and it shows the
            refusal as given rather than paraphrasing it.
          </p>
        </Surface>
      </section>

      <section>
        <Panel eyebrow="Limits" title="What this screen is not">
          <ul className="flex flex-col gap-3">
            {LIMITS.map((limit) => (
              <li key={limit} className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-lead" />
                <span className="text-ink-soft">{limit}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}

/** Bounded, and named so the note above and the query cannot disagree about the number. */
const LIST_LIMIT = 24;

/**
 * The honest edges of a screen that reads an archive back.
 *
 * Each one is a real gap rather than a caveat, and each is stated here because a reader
 * who finds it later in the schema — a nullable `uploader_user_id`, an unused
 * `intakes.media_id` — should not have to wonder whether it was known.
 */
const LIMITS = [
  "Nothing links an object to the submission that produced it. `intakes.media_id` is a restrict foreign key waiting for that write, so this screen lists evidence by its own content hash rather than by the valuation it went on to price.",
  "Attribution is mostly empty, and that is the database telling the truth: no users row is created when someone signs in yet, so an uploader resolves only where a row already exists.",
  "A signature is not an existence check. Signing happens locally without asking S3 anything, so a well-formed link whose object was never written answers 403 from the bucket rather than an error from the app.",
  "No retention policy and no Object Lock. Expiring evidence on a schedule is a decision about legal exposure, and it is not one a default should make.",
];
