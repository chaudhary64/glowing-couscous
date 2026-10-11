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
