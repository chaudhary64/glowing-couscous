import { EvidenceViewer } from "@/components/features/evidence/evidence-viewer";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { mayOpen } from "@/components/ui/role-link";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { scopeForUser } from "@/lib/records/scope";
import { formatBytes } from "@/lib/format";
import { archiveConfigured } from "@/lib/s3/archive";
import { findMediaAssetBySubmissionCode, listEvidence } from "@/lib/s3/media-assets";

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
 *
 * Both reads are cut by the caller's scope. An Operator or Admin reads the whole archive;
 * a brand's Viewer reads only the evidence behind credits the brand claimed, and until a
 * credit note names the brand the screen says "no claim on file" rather than listing
 * nothing. That sentence is a scope answer, not a failure, so it is not shown as one.
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
  const user = await requireAccess("/evidence");
  const scope = await scopeForUser(user);
  // A refusal from a scoped read is the scope's answer, not a broken database.
  const scoped = scope.kind !== "all";

  const params = await searchParams;
  const code = pick(params.code)?.trim() ?? "";

  const [listing, lookup] = await Promise.all([
    listEvidence(scope, LIST_LIMIT),
    // An empty box is not a query, so it is not a read: no id, no lookup to report on.
    code ? findMediaAssetBySubmissionCode(scope, code) : Promise.resolve(null),
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
        lede="Review the photos and voice notes linked to valuations."
        actions={
          mayOpen(user.role, "/intake") ? (
            <ButtonLink href="/intake" variant="secondary">
              Submit something new
            </ButtonLink>
          ) : undefined
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={archive ? "verified" : "hazard"}>
              {archive ? "Archive ready" : "Archive unavailable"}
            </Badge>
            <Badge tone={listing.configured ? "neutral" : "hazard"}>
              {listing.configured ? "Live records" : "Unavailable"}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {joined} of {assets.length} linked
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {attributed} of {assets.length} with an uploader
            </span>
          </div>
        }
      />

      <section>
        <Panel eyebrow="Lookup" title="Evidence behind a valuation">
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
                placeholder="LIVE-2026-04318826"
                autoComplete="off"
                spellCheck={false}
                maxLength={120}
                className="w-full border-[3px] border-ink bg-paper px-3 py-2.5 font-mono text-[14px] text-ink placeholder:text-ink-muted/70 focus:border-copper"
              />
            </div>
            <Button type="submit" variant="secondary" className="shrink-0">
              Look up
            </Button>
          </form>

          <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-muted">
            Enter the valuation ID shown on the valuation page.
          </p>

          {lookup ? (
            <div className="mt-4 border-t-[3px] border-ink pt-4">
              {!lookup.configured ? (
                <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                  No database is connected, so valuation IDs cannot be resolved.
                </p>
              ) : lookup.error ? (
                <p className={`max-w-3xl text-sm leading-relaxed ${scoped ? "text-ink-soft" : "text-hazard-ink"}`}>
                  {scoped ? lookup.error : `The lookup failed: ${lookup.error}`}
                </p>
              ) : lookup.asset === null ? (
                <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                  No evidence found for <span className="font-mono">{code}</span>.
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
                    This is the evidence the price came from, not the price itself: priced
                    figures are computed for one request and are not stored.
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
          note={`Newest first, up to ${LIST_LIMIT}.`}
        />
        <Stat
          label="Photos"
          value={listing.configured ? String(photos) : "—"}
          note="Photographs submitted for a valuation."
        />
        <Stat
          label="Voice notes"
          value={listing.configured ? String(voiceNotes) : "—"}
          note="The Hindi clips the transcript was made from."
        />
        <Stat
          label="Listed bytes"
          value={listing.configured ? formatBytes(listedBytes) : "—"}
          note="Combined size of the objects listed above."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Most recent"
          title="Archived submissions"
          note="Each image or clip opens through a private link created on demand that expires shortly after; nothing here is publicly reachable."
        />

        <Surface className="mt-4">
          {!listing.configured ? (
            <div className="p-4">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                This deployment has no records database, so the archive&rsquo;s rows were
                never recorded and there is nothing to list. The objects themselves were
                written, but without a record there is no way to find one from here.
              </p>
            </div>
          ) : listing.error ? (
            <div className="p-4">
              <p className={`max-w-3xl text-sm leading-relaxed ${scoped ? "text-ink-soft" : "text-hazard-ink"}`}>
                {scoped ? listing.error : `The archive could not be listed: ${listing.error}`}
              </p>
            </div>
          ) : assets.length === 0 ? (
            <div className="p-4">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                Nothing has been archived yet. The first submission on the intake screen
                appears here as soon as it is recorded.
              </p>
            </div>
          ) : (
            <EvidenceViewer assets={assets} />
          )}

          <p className="border-t border-rule px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
            Opening an object takes an account allowed to see this screen. Anything else is
            refused, and the refusal is shown as given rather than paraphrased.
          </p>
        </Surface>
      </section>

    </div>
  );
}

/** Bounded, and named so the note above and the query cannot disagree about the number. */
const LIST_LIMIT = 24;
