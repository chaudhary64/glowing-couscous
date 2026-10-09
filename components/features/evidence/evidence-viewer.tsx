"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes, formatTimestamp } from "@/lib/format";
import type { EvidenceAsset } from "@/lib/types";

/**
 * The archive, read back.
 *
 * Reads go through `GET /api/media/read` rather than being signed here or on the page,
 * because the route is where the authority lives: it requires a session, a role that
 * opens `/intake`, a same-origin request, and a key of the shape this archive actually
 * writes. Signing locally would be a second, weaker copy of those four rules — and the
 * one place they would drift is the place that hands out access to a collector's
 * photograph.
 *
 * Three states per object and no fourth. A refusal is shown in the API's own words,
 * because "the archive is not configured" (503) and "that key is not one this archive
 * writes" (400) are different problems with different fixes, and a screen that folded
 * both into "could not load" would send an operator to debug the wrong one.
 */
type Reading =
  | { state: "loading" }
  | { state: "ready"; url: string; expiresAt: string }
  | { state: "refused"; message: string };

/** A digest is 64 characters; a screen shows enough to compare two of them by eye. */
function shortDigest(digest: string | null): string {
  if (!digest) return "no digest recorded";
  return `${digest.slice(0, 12)}…${digest.slice(-6)}`;
}

export function EvidenceViewer({ assets }: { assets: EvidenceAsset[] }) {
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  /** Keys whose link was signed but whose bytes S3 would not serve. */
  const [unserved, setUnserved] = useState<Record<string, boolean>>({});

  const read = async (key: string) => {
    setUnserved((current) => ({ ...current, [key]: false }));
    setReadings((current) => ({ ...current, [key]: { state: "loading" } }));

    try {
      const response = await fetch(
        `/api/media/read?key=${encodeURIComponent(key)}`,
        { headers: { accept: "application/json" } },
      );
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        expiresAt?: string;
        message?: string;
      } | null;

      if (!response.ok || !body?.url || !body.expiresAt) {
        setReadings((current) => ({
          ...current,
          [key]: {
            state: "refused",
            message:
              body?.message ??
              `The read was refused with HTTP ${response.status}, and the response carried no explanation.`,
          },
        }));
        return;
      }

      setReadings((current) => ({
        ...current,
        [key]: { state: "ready", url: body.url as string, expiresAt: body.expiresAt as string },
      }));
    } catch (error) {
      // A thrown fetch is the network, not a refusal: no HTTP status ever arrived.
      setReadings((current) => ({
        ...current,
        [key]: {
          state: "refused",
          message: `The app could not be reached to sign a read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      }));
    }
  };

  const hide = (key: string) => {
    setUnserved((current) => ({ ...current, [key]: false }));
    setReadings((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <ul className="flex flex-col gap-px bg-rule">
      {assets.map((asset) => {
        const reading = readings[asset.storageKey];
        const isVoice = asset.kind === "voice";

        return (
          <li key={asset.storageKey} className="bg-paper-raised p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={isVoice ? "copper" : "neutral"}>
                    {isVoice ? "Voice note" : "Photo"}
                  </Badge>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {asset.mimeType ?? "type unknown"}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {formatBytes(asset.byteSize)}
                  </span>
                </div>

                <p className="mt-2 break-all font-mono text-[12px] text-ink">
                  {asset.storageKey}
                </p>
                <p className="mt-1 font-mono text-[11px] leading-snug text-ink-muted">
                  sha256 {shortDigest(asset.checksumSha256)} · archived{" "}
                  {formatTimestamp(asset.uploadedAt)} ·{" "}
                  {asset.uploaderName ?? "no uploader on record"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {reading?.state === "ready" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => hide(asset.storageKey)}
                  >
                    Hide
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={reading?.state === "loading"}
                    onClick={() => void read(asset.storageKey)}
                  >
                    {reading?.state === "loading"
                      ? "Signing…"
                      : reading?.state === "refused"
                        ? "Try again"
                        : "Read"}
                  </Button>
                )}
              </div>
            </div>

            {reading?.state === "refused" ? (
              <p className="mt-3 border-t border-hazard/40 pt-3 text-[12px] leading-relaxed text-hazard">
                {reading.message}
              </p>
            ) : null}

            {reading?.state === "ready" ? (
              <div className="mt-3 border-t border-rule pt-3">
                {isVoice ? (
                  <audio
                    controls
                    preload="none"
                    src={reading.url}
                    className="w-full"
                    onError={() =>
                      setUnserved((current) => ({
                        ...current,
                        [asset.storageKey]: true,
                      }))
                    }
                  >
                    This browser cannot play the archived clip.
                  </audio>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element --
                     The source is a presigned S3 URL that dies within the hour, so the
                     image optimizer can neither cache nor re-fetch it: routing it through
                     `next/image` would add a second read per render and put a short-lived
                     capability into the optimizer's cache key. A plain img is the honest
                     shape for a link that expires. */
                  <img
                    src={reading.url}
                    alt={`Archived submission ${asset.storageKey}`}
                    className="max-h-96 w-auto max-w-full border border-rule"
                    onError={() =>
                      setUnserved((current) => ({
                        ...current,
                        [asset.storageKey]: true,
                      }))
                    }
                  />
                )}

                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  Signed read · expires {formatTimestamp(reading.expiresAt)}
                </p>

                {unserved[asset.storageKey] ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-hazard">
                    The link was signed, but S3 would not serve the bytes behind it. That
                    means the key has no object at it — a signature is proof of nothing on
                    its own, because signing happens locally without asking S3 whether the
                    object exists.
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
