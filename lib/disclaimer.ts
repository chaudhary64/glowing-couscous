/**
 * The one place the prototype's money claim is written.
 *
 * Credits are the product's central artefact and they are simulated, so every screen that
 * prints an amount has to say so. That sentence had been retyped in nine files — "Simulated
 * credits — this prototype moves no money", "Simulated — no payout is made", "Credits are
 * simulated in this prototype — no real payout is issued" — and nine copies of a claim are
 * nine chances for it to weaken as it is edited. One of them had already drifted into
 * sounding like a smaller claim than the truth ("no payout is made" reads as a statement
 * about this screen rather than about the product).
 *
 * So: one label for a strip or a badge, one sentence for prose, and one helper that puts
 * the sentence after a panel's own. A screen may say what is specific to *it* — which
 * figure the money is tied to, what happens next — but not restate the claim in its own
 * words.
 */

/** Three words, for a badge or a strip. */
export const SIMULATED_LABEL = "Credits simulated";

/** The claim, whole, for prose: a footer, a claim list, a panel's own note. */
export const SIMULATED_CLAIM =
  "Credits are simulated: this prototype moves no money, and it is not a payout system.";

/** A panel's own sentence, with the claim after it. */
export function simulatedNote(lead: string): string {
  return `${lead} ${SIMULATED_CLAIM}`;
}
