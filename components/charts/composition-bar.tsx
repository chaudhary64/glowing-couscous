import type { MaterialCategory, MaterialLine } from "@/lib/types";

const TONES: Record<MaterialCategory, { fill: string; label: string }> = {
  precious: { fill: "var(--color-copper)", label: "Precious" },
  base: { fill: "var(--color-ink)", label: "Base metal" },
  hazardous: { fill: "var(--color-hazard)", label: "Hazardous" },
  inert: { fill: "var(--color-lead)", label: "Inert" },
};

/**
 * What the item is made of, by mass: one bar, a segment per material line, coloured by
 * grade. Segments grow in left to right. Lines too thin to see still appear in the
 * legend, so a 0.3 g gold fraction is never silently invisible.
 */
export function CompositionBar({ materials }: { materials: MaterialLine[] }) {
  const total = materials.reduce((sum, line) => sum + line.massGrams, 0);
  if (total <= 0) return null;
  const byCategory = (Object.keys(TONES) as MaterialCategory[])
    .map((category) => ({
      category,
      grams: materials.filter((line) => line.category === category).reduce((sum, line) => sum + line.massGrams, 0),
    }))
    .filter((entry) => entry.grams > 0);

  return (
    <figure className="mb-4">
      <div
        role="img"
        aria-label={`Composition by mass: ${byCategory.map((e) => `${TONES[e.category].label} ${((e.grams / total) * 100).toFixed(1)}%`).join(", ")}.`}
        className="flex h-3 w-full overflow-hidden bg-rule-soft"
      >
        {materials
          .filter((line) => line.massGrams > 0)
          .map((line, index) => (
            <span
              key={line.id}
              title={`${line.name} · ${line.massGrams} g`}
              className="chart-grow-x h-full border-r border-paper-raised last:border-r-0"
              style={{
                width: `${(line.massGrams / total) * 100}%`,
                minWidth: "2px",
                background: TONES[line.category].fill,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
        {byCategory.map((entry) => (
          <span key={entry.category} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2" style={{ background: TONES[entry.category].fill }} />
            {TONES[entry.category].label} {((entry.grams / total) * 100).toFixed(entry.grams / total < 0.01 ? 2 : 0)}%
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
