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
 * It is pinned to the bottom of the viewport, over the page, rather than sitting in the
 * flow at the top. That is deliberate: in the flow the notice was the first thing at the
 * viewport's top-left corner, where the browser's and the device's own chrome draws over
 * the page — a status bar, a floating badge — and the "C" of "Cookies & location" was
 * hidden on every page. Pinned to the foot, nothing the page itself renders can land on
 * its heading.
 *
 * It pays for that with the trade-off this position has always had: until it is answered
 * it covers the foot of the page, which on the collector's phone is where "Hand over
 * e-waste" sits. It is answered once, and the notice leaves the moment it is.
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
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-6 sm:pb-6">
      <div
        role="region"
        aria-label="Cookies and location"
        // A 5px edge and no shadow: on a white page the way to make something stand out
        // is to draw it heavier, not to lift it.
        className="mx-auto max-w-3xl border-[5px] border-ink bg-paper p-4 text-ink sm:p-5"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-copper">Cookies &amp; location</p>
        <p className="mt-2 text-[13px] leading-snug text-ink-soft">
          EcoEPR uses one essential cookie to keep you signed in. With your permission, an intake also records this
          device&apos;s location, so the item is filed to its district and counted on the hotspot map. It is shown only
          rounded to a ~38 m cell, never as an address, and collectors are paid either way. You can change this later by
          clearing this site&apos;s cookies.
        </p>
        {/*
          One column on a phone, two equal halves from `md` up.

          The two answers are the same size and weight, so they share the row rather than
          sizing to their own labels: side by side with `flex-1` they are the same width,
          and stacked they stretch to the card, instead of the ragged pair a wrapping row
          of label-sized buttons produced. `md`, not `sm`, because "Accept cookies &
          location" and "Essential cookies only" cannot share a 640px card without one of
          them breaking its label across lines.
        */}
        <div className="mt-4 flex flex-col gap-2 md:flex-row">
          <button
            type="button"
            onClick={() => choose(true)}
            className="border-[3px] border-ink bg-ink px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-paper hover:bg-paper hover:text-ink md:flex-1"
          >
            Accept cookies &amp; location
          </button>
          <button
            type="button"
            onClick={() => choose(false)}
            className="border-[3px] border-ink bg-ink px-5 py-2.5 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-paper hover:bg-paper hover:text-ink md:flex-1"
          >
            Essential cookies only
          </button>
        </div>
      </div>
    </div>
  );
}
