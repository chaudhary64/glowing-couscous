import { EvidenceViewer } from "@/components/features/evidence/evidence-viewer";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { formatBytes } from "@/lib/format";
import { archiveConfigured } from "@/lib/s3/archive";
import {
  findMediaAssetBySubmissionCode,
  listRecentMediaAssets,
} from "@/lib/s3/media-assets";

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
 *
 * Each object also carries the submission it produced. That is the join the screen was
 * missing: the row is an `intakes` row whose `code` is the id the priced result carries,
 * so the archive can be read from a valuation rather than only by its own content hash.
 * See `lib/s3/intakes.ts` for why the id is that one and what it does not yet include.
 *
 * That join is also the lookup below. An operator holding an id off a priced result pastes
 * it and gets the object behind it: `intakes_code_uq` is the index,
 * `findMediaAssetBySubmissionCode` is the read, and what comes back is the same shape the
 * listing renders — so an object reads identically however the operator reached it.
 */

type Search = Record<string, string | string[] | undefined>;

/** The same one-value pick the auth pages use: a query string can repeat a key. */
const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireAccess("/evidence");

  const params = await searchParams;
  const code = pick(params.code)?.trim() ?? "";

  const [listing, lookup] = await Promise.all([
    listRecentMediaAssets(LIST_LIMIT),
    // An empty box is not a query, so it is not a read: no id, no lookup to report on.
    code ? findMediaAssetBySubmissionCode(code) : Promise.resolve(null),
  ]);
  const assets = listing.assets;
  const photos = assets.filter((asset) => asset.kind === "photo").length;
  const voiceNotes = assets.length - photos;
  const listedBytes = assets.reduce(
    (total, asset) => total + (asset.byteSize ?? 0),
    0,
  );
  const attributed = assets.filter((asset) => asset.uploaderName !== null).length;
  const joined = assets.filter((asset) => asset.submissionCode !== null).length;
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
              {joined} of {assets.length} joined to a submission
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {attributed} of {assets.length} attributed to a user row
            </span>
          </div>
        }
      />

      <section>
        <Panel eyebrow="Lookup" title="The object behind a valuation">
          <form
            method="get"
            action="/evidence"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex w-full flex-col">
              <label
                htmlFor="code"
                className="mb-1 font-display text-[12px] uppercase tracking-[0.1em] text-ink"
              >
                Valuation id
              </label>
              <input
                id="code"
                name="code"
                defaultValue={code}
                placeholder="LIVE-2026-0431"
                autoComplete="off"
                spellCheck={false}
                maxLength={120}
                className="w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-[14px] text-ink placeholder:text-ink-muted/70 focus:border-copper"
              />
            </div>
            <Button type="submit" variant="secondary" className="shrink-0">
              Look up
            </Button>
          </form>

          <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-muted">
            The id a priced result carries — the <span className="font-mono">LIVE-2026-…</span>{" "}
            string the valuation screen shows. It is one indexed read on{" "}
            <span className="font-mono">intakes_code_uq</span>, and it matches exactly: no
            near-matches, because the failure this lookup must not have is handing an
            operator the photograph behind somebody else&rsquo;s submission.
          </p>

          {lookup ? (
            <div className="mt-4 border-t-2 border-ink pt-4">
              {!lookup.configured ? (
                <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                  This deployment has no <span className="font-mono">DATABASE_URL</span>, so
                  no id can be resolved: the archive&rsquo;s rows were never recorded. The
                  bytes are in the bucket under their content-addressed keys, and nothing
                  here can walk from an id to one.
                </p>
              ) : lookup.error ? (
                <p className="max-w-3xl text-sm leading-relaxed text-hazard">
                  The lookup failed: {lookup.error}
                </p>
              ) : lookup.asset === null ? (
                <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                  Nothing in the archive holds <span className="font-mono">{code}</span>.
                  Either that id was never priced here, or it was priced and the{" "}
                  <span className="font-mono">intakes</span> row was not written — an id is
                  findable only once the submission behind it is recorded. The third shape
                  is an analysis that failed: the object is archived, nothing was priced,
                  and no id was minted for it.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                      Found
                    </span>
                    <span className="font-mono text-[13px] text-ink">{code}</span>
                    {lookup.summary ? (
                      <span className="text-[13px] leading-relaxed text-ink-soft">
                        {lookup.summary}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-ink-muted">
                    The row this resolves through is a submission, not a valuation: the
                    priced figures were computed for one request and are not stored, so
                    this is the evidence the price came from rather than the price.
                  </p>
                  <Surface className="mt-3">
                    <EvidenceViewer assets={[lookup.asset]} />
                  </Surface>
                </>
              )}
            </div>
          ) : null}
        </Panel>
      </section>

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
                <span className="font-mono">/intake</span> writes an object, its row, and
                the submission that joins it to what was priced, and all three appear here
                as soon as that request answers.
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
 * who finds it later in the schema — a nullable `uploader_user_id`, a nullable
 * `intakes.collector_id`, an `items` table with no writer — should not have to wonder
 * whether it was known.
 */
const LIMITS = [
  "Only the primary asset is joined to a submission. `intakes.media_id` is unique, so a photograph submitted with a voice note beside it is one submission pointing at the photograph: the clip is archived and listed here with nothing to look it up by.",
  "The trail stops at the submission id. The row behind it is an `intakes` row — `items` and `valuations` are still unwritten — so the id a valuation is known by is recorded and the priced figures themselves are not: they are computed per request and live only in that response.",
  "Attribution is mostly empty, and that is the database telling the truth: no users row is created when someone signs in yet, so an uploader resolves only where a row already exists.",
  "A signature is not an existence check. Signing happens locally without asking S3 anything, so a well-formed link whose object was never written answers 403 from the bucket rather than an error from the app.",
  "No retention policy and no Object Lock. Expiring evidence on a schedule is a decision about legal exposure, and it is not one a default should make.",
];
