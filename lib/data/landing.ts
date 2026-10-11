import type { AuthHref, ProductHref } from "@/lib/types";

/** One way into the app from the public page: a label, and where it goes. */
export type LandingEntryLink = { label: string; href: ProductHref | AuthHref };

/**
 * The landing's ways in, which are not the same two for both visitors.
 *
 * A signed-out visitor is the audience this page is written for, and "Open the app" is
 * an offer they cannot take: every working screen sits behind a session, so that button
 * only performs a redirect into the sign-in form on the way. The pair is therefore
 * decided here, once — the app to open when a session exists, the account to sign in
 * with (and the one to create) when it does not — and the header, the hero, the closing
 * band and the footer all read their words and hrefs from this function rather than
 * each restating the rule and drifting from the others.
 */
export function landingEntry(signedIn: boolean): {
  /** The loud one: the button in the header, hero and closing band. */
  primary: LandingEntryLink;
  /** The quiet one: an underlined link, gone once a session exists. */
  secondary: LandingEntryLink | null;
} {
  if (signedIn) {
    return { primary: { label: "Open the app", href: "/dashboard" }, secondary: null };
  }
  return {
    primary: { label: "Sign in", href: "/login" },
    secondary: { label: "Create an account", href: "/signup" },
  };
}

/**
 * The landing page's own sections, in the order they appear.
 *
 * Two pieces of chrome need this list — the header's centred links and the footer's "This
 * page" column — and they have drifted apart before, because each carried its own copy.
 * One list, so a band renamed on the page is renamed in both places or in neither.
 *
 * Hrefs are in-page anchors, not routes: the landing is one argument and these are its
 * beats. `id` on the matching `<Band>` is what makes them work, and `scroll-mt-24` on the
 * band is what keeps the sticky header off the heading.
 */
export const landingSections = [
  { label: "The problem", href: "#problem" },
  { label: "The artefact", href: "#artefact" },
  { label: "How it works", href: "#how" },
  { label: "The screens", href: "#loop" },
] as const;
