import type { Recycler } from "@/lib/types";

/**
 * Which accepted streams require a licensed hazardous route.
 *
 * This list used to exist in two components, which is the kind of duplication
 * that silently drifts: the table would call a facility hazardous-eligible while
 * the allocation panel called it standard. One copy, one answer.
 */
export const hazardousStreams = [
  "Batteries",
  "Li-ion packs",
  "Lead acid",
  "CRT glass",
] as const;

export function isHazardousStream(stream: string): boolean {
  return (hazardousStreams as readonly string[]).includes(stream);
}

/** Only a CPCB-registered line may take a hazardous stream. */
export function takesHazardous(recycler: Recycler): boolean {
  return recycler.accepts.some(isHazardousStream);
}

/** A reuse partner refurbishes working devices; it is not a recycler. */
export function isReusePartner(recycler: Recycler): boolean {
  return recycler.accepts.some((stream) =>
    stream.toLowerCase().includes("working"),
  );
}

/** A registration number is the compliance identity, not a display string. */
export function isRegistered(recycler: Recycler): boolean {
  return recycler.cpcbId.startsWith("CPCB/");
}
