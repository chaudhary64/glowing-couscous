import { districtByCode, districtForPoint, type DistrictGeo } from "./districts";
import { wardByCode, wardForPoint, type WardGeo } from "./wards";

/**
 * Where a point is filed, anywhere in India.
 *
 * Two levels, and a point is filed to the *finest* one that covers it:
 *
 * - **City ward**, where we hold a city's ward map (today: Mumbai's 24 BMC wards).
 *   A van is dispatched to a ward, so where the detail exists it is used.
 * - **District**, everywhere else in India (735 of them).
 *
 * Its district is always known as well, so pressure can be compared across the whole
 * country at district level while Mumbai keeps its ward-level view.
 *
 * Both kinds live in the `wards` table as "filing areas" (code, name, region, centroid,
 * boundary): `MCGM-<letter>` for a BMC ward, `IND-<id>` for a district. The
 * `ward_code` columns on intakes and items hold the finest code. Server-side only.
 */

export type AreaKind = "ward" | "district";

export interface FilingArea {
  code: string;
  name: string;
  kind: AreaKind;
  /** The city for a ward, the state for a district. */
  region: string | null;
  areaKm2: number;
  centroid: { latitude: number; longitude: number };
}

const fromWard = (w: WardGeo): FilingArea => ({
  code: w.code,
  name: w.name,
  kind: "ward",
  region: "Mumbai",
  areaKm2: w.areaKm2,
  centroid: w.centroid,
});

const fromDistrict = (d: DistrictGeo): FilingArea => ({
  code: d.code,
  name: d.name,
  kind: "district",
  region: d.state,
  areaKm2: d.areaKm2,
  centroid: d.centroid,
});

export interface Filing {
  /** The finest area: the ward if there is one, else the district. Null outside India. */
  area: FilingArea | null;
  district: FilingArea | null;
  ward: FilingArea | null;
}

export function fileLocation(latitude: number, longitude: number): Filing {
  const district = districtForPoint(latitude, longitude);
  // A ward only counts inside India's outline (the BMC snap must not pull a point at sea
  // into a ward), and only where its district agrees it is Mumbai.
  const ward = district && /^Mumbai/.test(district.name) ? wardForPoint(latitude, longitude) : null;
  const d = district ? fromDistrict(district) : null;
  const w = ward ? fromWard(ward) : null;
  return { area: w ?? d, district: d, ward: w };
}

export function areaByCode(code: string | null | undefined): FilingArea | undefined {
  const ward = wardByCode(code);
  if (ward) return fromWard(ward);
  const district = districtByCode(code);
  return district ? fromDistrict(district) : undefined;
}

/** The boundary to store with an area row, as GeoJSON. */
export function areaBoundary(code: string): { type: "MultiPolygon"; coordinates: unknown } | null {
  const ward = wardByCode(code);
  if (ward) return { type: "MultiPolygon", coordinates: ward.boundary };
  const district = districtByCode(code);
  return district ? { type: "MultiPolygon", coordinates: district.boundary } : null;
}
