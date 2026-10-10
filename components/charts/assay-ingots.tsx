import type { MaterialCategory, MaterialLine } from "@/lib/types";

/** Each ingot in its metal's own colour; anything unlisted falls back to its grade. */
const METAL: Record<string, string> = {
  Cu: "#c8743d",
  Au: "#e3bd55",
  Ag: "#d3dae1",
  Pd: "#b9c3cd",
  Pt: "#c6cdd4",
  Sn: "#a7b1bb",
  Fe: "#6c7782",
  Al: "#c2c9cf",
  Ni: "#9fa6a3",
  Pb: "#7a838c",
  Zn: "#a3acb5",
  Li: "#b8c0c8",
  Co: "#5f7fa8",
};
const GRADE: Record<MaterialCategory, string> = {
  precious: "#e3bd55",
  base: "#9aa7b4",
  hazardous: "#7a838c",
  inert: "#3f4b56",
};

/**
 * The assay as metal on a bench: one 3D ingot per material, its height by the share of
 * the item's mass it makes up (square-rooted, so a 0.3 g gold fraction still stands up
 * next to 150 g of copper), in its metal's own colour; a hazardous fraction glows red.
 * Pure CSS 3D — three lit faces per ingot, no WebGL — and it leans with the pointer
 * (`data-tilt`). The figures under each ingot carry the numbers; the shapes are the
 * picture.
 */
export function AssayIngots({ materials }: { materials: MaterialLine[] }) {
  const lines = materials.filter((line) => line.massGrams > 0);
  const total = lines.reduce((sum, line) => sum + line.massGrams, 0);
  if (total <= 0) return null;
  const MAX = 96;

  return (
    <figure
      data-tilt="10"
      className="ingots-stage relative mb-5 flex justify-center px-2 pb-2 pt-10"
      aria-label={`Material assay by mass: ${lines.map((l) => `${l.name} ${l.massGrams} g`).join(", ")}.`}
      role="img"
    >
      <div className="ingots flex items-end gap-6">
        {lines.map((line, index) => {
          const share = line.massGrams / total;
          const height = Math.max(8, Math.round(Math.sqrt(share) * MAX));
          return (
            <div key={line.id} className="flex flex-col items-center gap-3">
              <div
                className={line.category === "hazardous" ? "ingot ingot--hazard" : "ingot"}
                style={
                  {
                    "--h": `${height}px`,
                    "--c": METAL[line.symbol] ?? GRADE[line.category],
                    animationDelay: `${index * 90}ms`,
                  } as React.CSSProperties
                }
              >
                <span className="ingot__face ingot__front" />
                <span className="ingot__face ingot__right" />
                <span className="ingot__face ingot__top" />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {line.symbol || "—"} · {line.massGrams} g
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
