import { CITY_BOUNDS, WARD_SOURCE, WARDS } from "@/lib/geo/wards";

/**
 * The 24 BMC wards, drawn from their real boundaries as a static SVG.
 *
 * For the public write-up, which must not show live intake locations: this is geography
 * only — the shapes the hotspot map files every point into — with no data on it.
 * Projection is equirectangular scaled by cos(latitude), which at Mumbai's size is
 * indistinguishable from the web map.
 */
export function WardOutline() {
  const midLat = ((CITY_BOUNDS.south + CITY_BOUNDS.north) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const width = (CITY_BOUNDS.east - CITY_BOUNDS.west) * kx;
  const height = CITY_BOUNDS.north - CITY_BOUNDS.south;
  const W = 520;
  const H = Math.round((W * height) / width);
  const x = (lng: number) => (((lng - CITY_BOUNDS.west) * kx) / width) * W;
  const y = (lat: number) => ((CITY_BOUNDS.north - lat) / height) * H;

  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} className="mx-auto h-auto w-full max-w-md" role="img" aria-label="Map of the 24 BMC ward boundaries of Mumbai">
        {WARDS.map((ward) => (
          <g key={ward.code}>
            <path
              d={ward.boundary
                .map((polygon) => polygon.map((ring) => `M${ring.map(([lng, lat]) => `${x(lng).toFixed(1)},${y(lat).toFixed(1)}`).join("L")}Z`).join(""))
                .join("")}
              fillRule="evenodd"
              className="fill-paper-raised stroke-ink"
              strokeWidth={0.8}
            >
              <title>{ward.name} · {ward.areaKm2} km²</title>
            </path>
            <text
              x={x(ward.centroid.longitude)}
              y={y(ward.centroid.latitude)}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-ink font-mono text-[9px]"
            >
              {ward.letter}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-[12px] leading-relaxed text-ink-muted">
        The 24 administrative wards of the Brihanmumbai Municipal Corporation, drawn from their
        real boundaries. Every geotagged intake is filed into one of these. {WARD_SOURCE.attribution}.
      </figcaption>
    </figure>
  );
}
