/**
 * Density bands, shared by the scatter and the ranked list.
 *
 * One definition for both is the point: a marker, its legend dot and its table row
 * must never disagree about where "elevated" starts. It lives outside `ward-map.tsx`
 * because the ranked list is a client component, and importing the bands from the map
 * would drag the whole map into the client bundle for the sake of one pure function.
 */

export type Band = {
  tone: "hazard" | "copper" | "lead";
  label: string;
  range: string;
};

export function densityBand(density: number): Band {
  if (density >= 80) {
    return { tone: "hazard", label: "High pressure", range: "80–100" };
  }
  if (density >= 60) {
    return { tone: "copper", label: "Elevated", range: "60–79" };
  }
  return { tone: "lead", label: "Baseline", range: "0–59" };
}
