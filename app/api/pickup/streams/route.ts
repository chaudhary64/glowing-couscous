import { authorizePickup, callPickupApi } from "@/lib/pickup/api";

/**
 * GET /api/pickup/streams — the rate card, so the gate can preview what a weighed mass
 * will pay before the PIN is entered. The preview is arithmetic on the same numbers the
 * Lambda uses; the note it issues is still the figure of record.
 */
export async function GET(request: Request) {
  const access = await authorizePickup(request, "/gate");
  if (!access.ok) return access.denied;
  return callPickupApi(access.user, "GET", "/streams");
}
