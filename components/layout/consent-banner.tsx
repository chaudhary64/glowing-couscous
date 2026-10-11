"use client";

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
 *
 * It sits at the top of the page, in the flow, rather than floating over it. Pinned to
 * the bottom of the viewport it covered whatever was there until answered — on the
 * collector's phone that was the "Hand over e-waste" button itself.
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
    <div className="px-3 pt-3 sm:px-6 sm:pt-6">
      <div
        role="region"
        aria-label="Cookies and location"
        // A 5px edge and no shadow: on a white page the way to make something stand out
        // is to draw it heavier, not to lift it.
        className="mx-auto max-w-3xl border-[5px] border-ink bg-paper p-4 text-ink sm:p-5"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-copper">Cookies &amp; location</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          EcoEPR uses one essential cookie to keep you signed in. With your permission, an intake also records this
          device&apos;s location, so the item is filed to its district and counted on the hotspot map. It is shown only
          rounded to a ~38 m cell, never as an address, and collectors are paid either way. You can change this later by
          clearing this site&apos;s cookies.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => choose(true)}
            className="border-[3px] border-ink bg-ink px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-paper hover:bg-paper hover:text-ink"
          >
            Accept cookies &amp; location
          </button>
          <button
            type="button"
            onClick={() => choose(false)}
            className="border-[3px] border-ink bg-ink px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-paper hover:bg-paper hover:text-ink"
          >
            Essential cookies only
          </button>
        </div>
      </div>
    </div>
  );
}
