"use client";

import Link from "next/link";

import { saveConsent, useConsent } from "@/lib/consent";

/**
 * The cookie and location notice, shown once until a choice is made.
 *
 * Both answers are the same size and weight: declining location is as easy as
 * accepting it, and the app works either way (sign-in still needs its one essential
 * cookie, which the notice says rather than asks).
 *
 * Choosing location here is also a click, so the browser's own permission prompt is
 * asked for straight away, while the visitor is looking at why.
 */
export function ConsentBanner() {
  const consent = useConsent();
  if (consent !== null) return null; // unknown (server) or already chosen

  const choose = (location: boolean) => {
    saveConsent(location);
    if (location && "geolocation" in navigator) {
      // Ask the browser now, in response to this click; the result is not used here.
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    }
  };

  return (
    <div
      role="region"
      aria-label="Cookies and location"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl glass border-2 border-ink bg-[rgb(14_20_26)] p-4 text-ink shadow-[0_18px_50px_-18px_rgb(0_0_0/0.55)] sm:inset-x-6 sm:bottom-6 sm:p-5"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">Cookies &amp; location</p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        EcoEPR uses one essential cookie to keep you signed in. With your permission, an intake also records this
        device&apos;s location, so the item is filed to its district and counted on the hotspot map. It is shown only
        rounded to a ~38 m cell, never as an address, and collectors are paid either way. You can change this later by
        clearing this site&apos;s cookies.{" "}
        <Link href="/doc/features/heatmap" className="underline decoration-rule underline-offset-2 hover:decoration-copper">
          How location is used
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choose(true)}
          className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-paper hover:text-ink"
        >
          Accept cookies &amp; location
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-paper hover:text-ink"
        >
          Essential cookies only
        </button>
      </div>
    </div>
  );
}
