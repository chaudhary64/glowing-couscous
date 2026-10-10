/**
 * The routing decision, as numbered rules that a reviewer can check one at a time.
 *
 * This is the feature's whole claim — *hazardous items go only to authorised
 * recyclers* — so the rules are deliberately small, ordered and boring, and every
 * candidate that is dropped is dropped **with a reason that is returned to the
 * caller**. A router that silently picks a different site teaches nobody why the
 * load did not stop at the nearest one, and the refusal list is the audit trail.
 *
 * | Rule | Removes | Because |
 * |---|---|---|
 * | R-2 | a site that does not accept the stream | "Boards" on a licence is not "boards" on a floor |
 * | R-3 | a site with no hazardous authorisation for it | the point of the feature |
 * | R-4 | a reuse-only operator | a reuse partner pays a revenue share, not a scrap credit, and is not a recycling destination |
 * | R-5 | an inactive site | a lapsed partner is still a row |
 * | R-6 | a site already at today's licensed capacity | the ceiling is per day, and accepting the load would break it |
 *
 * R-3 runs **before** any preference is applied, so "same city" can never outrank a
 * licence. That ordering is the rule; a nearer unlicensed site is the failure this
 * module exists to prevent.
 *
 * What survives is ranked R-7: same city, then the most remaining capacity, then the
 * shortest SLA, then the id. Every tie-break after the first is deterministic, so two
 * identical requests produce the same route and the check script can assert it.
 */
import { estimateDistanceKm, estimateEtaMinutes, routeLabel } from "./catalogue.mjs";

export const RULES = {
  STREAM_NOT_ACCEPTED: "R-2",
  NOT_LICENSED_FOR_HAZARDOUS_STREAM: "R-3",
  REUSE_ONLY: "R-4",
  FACILITY_INACTIVE: "R-5",
  AT_CAPACITY_TODAY: "R-6",
};

const REFUSAL_TEXT = {
  [RULES.STREAM_NOT_ACCEPTED]: (row) =>
    row.note ?? `${row.facilityName} holds no licence for this stream`,
  [RULES.NOT_LICENSED_FOR_HAZARDOUS_STREAM]: (row) =>
    row.note ??
    `${row.facilityName} accepts the stream but is not authorised for its hazardous class`,
  [RULES.REUSE_ONLY]: () =>
    "Reuse-only operator: pays a revenue share, not a scrap credit",
  [RULES.FACILITY_INACTIVE]: () => "Facility is not active",
  [RULES.AT_CAPACITY_TODAY]: (row) =>
    `Licensed capacity for today is already committed (${row.capacityKgPerDay} kg/day)`,
};

/**
 * @param {object} input
 * @param {object} input.stream          the catalogue row: hazard and rates live here
 * @param {string} input.city            where the load is
 * @param {number} input.declaredMassG   what the collector declared
 * @param {string} input.itemCode        the priced item this load carries
 * @param {Array}  input.authorizations  every facility's opinion on the stream
 * @param {Map<string, number>} input.assignedMassGByFacility  already committed today
 */
export function routeLoad({
  stream,
  city,
  declaredMassG,
  itemCode,
  authorizations,
  assignedMassGByFacility,
}) {
  const refused = [];
  const survivors = [];

  for (const row of authorizations) {
    const assignedMassG = assignedMassGByFacility.get(row.facilityId) ?? 0;
    const capacityKgPerDay = Number(row.capacityKgPerDay ?? 0);
    const remainingKg = Math.max(0, capacityKgPerDay - assignedMassG / 1000);

    const failure = firstFailingRule(row, stream, declaredMassG / 1000, remainingKg);
    if (failure) {
      refused.push(refusal(row, failure, declaredMassG));
      continue;
    }

    survivors.push({ row, assignedMassG, capacityKgPerDay, remainingKg });
  }

  survivors.sort((a, b) => {
    const aSameCity = a.row.city === city ? 0 : 1;
    const bSameCity = b.row.city === city ? 0 : 1;
    if (aSameCity !== bSameCity) return aSameCity - bSameCity;
    if (b.remainingKg !== a.remainingKg) return b.remainingKg - a.remainingKg;
    if (a.row.slaHours !== b.row.slaHours) return a.row.slaHours - b.row.slaHours;
    return String(a.row.facilityId).localeCompare(String(b.row.facilityId));
  });

  const candidatesConsidered = authorizations.length;

  if (survivors.length === 0) {
    return {
      chosen: null,
      refused,
      candidatesConsidered,
      notes: refused.map(describe),
    };
  }

  const best = survivors[0];
  const distanceKm = estimateDistanceKm(city, best.row.city, itemCode);
  return {
    chosen: {
      facilityId: best.row.facilityId,
      facilityName: best.row.facilityName,
      cpcbLicense: best.row.cpcbLicense,
      city: best.row.city,
      slaHours: best.row.slaHours,
      capacityKgPerDay: best.capacityKgPerDay,
      assignedMassGToday: best.assignedMassG,
      remainingKg: Number(best.remainingKg.toFixed(3)),
      hazardousAuthorized: Boolean(best.row.hazardousAuthorized),
      interCity: best.row.city !== city,
      distanceKm,
      etaMinutes: estimateEtaMinutes(distanceKm),
      routeLabel: routeLabel(best.row.city, `${itemCode}:${stream.code}`),
    },
    refused,
    candidatesConsidered,
    notes: [
      `${candidatesConsidered} facilities held an opinion on ${stream.code}`,
      ...refused.map(describe),
      `R-7 ranked ${survivors.length} licensed destination(s); ${best.row.facilityId} won on ${
        best.row.city === city ? "same-city location" : "capacity for an inter-city route"
      }`,
    ],
  };
}

/** The first rule, in order, that disqualifies a facility for this load. */
function firstFailingRule(row, stream, declaredKg, remainingKg) {
  if (row.accepted !== true) return RULES.STREAM_NOT_ACCEPTED;
  if (stream.hazardous && row.hazardousAuthorized !== true) {
    return RULES.NOT_LICENSED_FOR_HAZARDOUS_STREAM;
  }
  if (row.reuseOnly === true) return RULES.REUSE_ONLY;
  if (row.active === false) return RULES.FACILITY_INACTIVE;
  if (remainingKg < declaredKg) return RULES.AT_CAPACITY_TODAY;
  return null;
}

function refusal(row, rule, declaredMassG) {
  return {
    recyclerId: row.facilityId,
    name: row.facilityName,
    cpcbLicense: row.cpcbLicense,
    city: row.city,
    rule,
    reason: (REFUSAL_TEXT[rule] ?? (() => "Not a valid destination"))(row),
    declaredMassG,
  };
}

function describe(entry) {
  return `${entry.rule} refused ${entry.recyclerId}: ${entry.reason}`;
}
