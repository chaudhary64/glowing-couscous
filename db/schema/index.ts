/**
 * The whole schema, one import.
 *
 * Files are layered so that imports flow one way only — a module may import from
 * the ones above it and never from the ones below:
 *
 *   columns, enums        primitives, no dependencies
 *   identity              users, organizations, memberships
 *   network               collectors, facilities, waste streams
 *   intake                 media, intakes, extracted fields
 *   catalog                items, material breakdown, rate cards
 *   valuation              valuations, gatekeeper verdicts, decisions, model metrics
 *   logistics              pickups, credit notes, EPR notes, ledger
 *   geo                    wards, geopoints, hotspot clusters
 *   ops                    activity feed, notifications, audit log, channels
 *
 * The one place a cycle could have appeared — an intake pointing at the item it
 * resolved to, while the item points back at the intake — is modelled as a single
 * link, `items.intake_id`. One intake resolves to one item, so the second column
 * would have been redundant as well as circular.
 */

export * from "./columns";
export * from "./enums";

export * from "./identity";
export * from "./network";
export * from "./intake";
export * from "./catalog";
export * from "./valuation";
export * from "./logistics";
export * from "./geo";
export * from "./ops";
