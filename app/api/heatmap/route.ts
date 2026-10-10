import { authorizeUser, jsonResponse, type AccessAction } from "@/lib/ai/http";
import { getHeatmap } from "@/lib/heatmap/store";
import type { MaterialCategory } from "@/lib/types";

/**
 * GET /api/heatmap — the points, clusters and ward pressure behind `/map`.
 *
 *   ?category=precious|base|hazardous|inert
 *   ?hazardous=1              hazardous items only (the routing question a ward asks first)
 *
 * Same authority as the screen: any signed-in role may look. Acting on a site is
 * `POST /api/heatmap/dispatch`, which is gated higher.
 */

const VIEWING: AccessAction = {
  subject: "Viewing the hotspot map",
  signIn: "view the hotspot map",
  refuse: "view the hotspot map",
};

const CATEGORIES: MaterialCategory[] = ["precious", "base", "hazardous", "inert"];

export async function GET(request: Request) {
  const access = await authorizeUser(request, "/map", VIEWING);
  if (!access.ok) return access.denied;

  const params = new URL(request.url).searchParams;
  const categoryParam = params.get("category") as MaterialCategory | null;
  const category = categoryParam && CATEGORIES.includes(categoryParam) ? categoryParam : undefined;

  const data = await getHeatmap({
    filter: { category, hazardousOnly: params.get("hazardous") === "1" },
  });
  return jsonResponse(data);
}
