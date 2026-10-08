import type { HotspotCluster, Ward } from "@/lib/types";

/**
 * Ward-level dumping pressure for the Mumbai pilot.
 *
 * Coordinates are normalised 0–100 on both axes so the scatter renders without a
 * map library; the label carries the real place name instead.
 */
export const wards: Ward[] = [
  { id: "W-ME", name: "M-East (Deonar)", city: "Mumbai", density: 94, pickups: 212, flaggedSites: 7, x: 78, y: 62 },
  { id: "W-GS", name: "G-South (Worli)", city: "Mumbai", density: 41, pickups: 88, flaggedSites: 2, x: 34, y: 71 },
  { id: "W-KE", name: "K-East (Andheri East)", city: "Mumbai", density: 76, pickups: 164, flaggedSites: 5, x: 22, y: 28 },
  { id: "W-L", name: "L Ward (Kurla)", city: "Mumbai", density: 88, pickups: 191, flaggedSites: 6, x: 68, y: 46 },
  { id: "W-HW", name: "H-West (Bandra)", city: "Mumbai", density: 52, pickups: 103, flaggedSites: 3, x: 26, y: 58 },
  { id: "W-PN", name: "P-North (Malad)", city: "Mumbai", density: 68, pickups: 141, flaggedSites: 4, x: 14, y: 16 },
  { id: "W-MH", name: "M-West (Chembur)", city: "Mumbai", density: 61, pickups: 122, flaggedSites: 3, x: 82, y: 51 },
  { id: "W-FN", name: "F-North (Sion)", city: "Mumbai", density: 73, pickups: 158, flaggedSites: 4, x: 58, y: 57 },
];

export const hotspots: HotspotCluster[] = [
  {
    id: "HS-01",
    label: "Deonar peripheral lane",
    wardId: "W-ME",
    landMark: "Behind Deonar abattoir road",
    radiusM: 320,
    detections: 74,
    topMaterial: "Mixed boards + CRT glass",
    firstSeen: "22 Sep 2026",
    status: "van-assigned",
  },
  {
    id: "HS-02",
    label: "Kurla scrap lane cluster",
    wardId: "W-L",
    landMark: "LBS Marg, Kurla West",
    radiusM: 180,
    detections: 58,
    topMaterial: "Cable + copper",
    firstSeen: "28 Sep 2026",
    status: "open",
  },
  {
    id: "HS-03",
    label: "Andheri MIDC back plots",
    wardId: "W-KE",
    landMark: "Near Marol industrial estate",
    radiusM: 260,
    detections: 46,
    topMaterial: "Printer + PSU units",
    firstSeen: "01 Oct 2026",
    status: "open",
  },
  {
    id: "HS-04",
    label: "Malad nala bank",
    wardId: "W-PN",
    landMark: "Malad Link Road drain",
    radiusM: 150,
    detections: 29,
    topMaterial: "Battery packs",
    firstSeen: "04 Oct 2026",
    status: "van-assigned",
  },
  {
    id: "HS-05",
    label: "Chembur market rear",
    wardId: "W-MH",
    landMark: "Chembur station east",
    radiusM: 120,
    detections: 17,
    topMaterial: "Household appliances",
    firstSeen: "03 Oct 2026",
    status: "cleared",
  },
];

export const heatmapStats = {
  geotaggedPickups: 1079,
  wardsCovered: wards.length,
  openHotspots: hotspots.filter((spot) => spot.status === "open").length,
  topWard: wards[0].name,
  clustering: "OpenSearch geohash grid, 150 m cell",
};
