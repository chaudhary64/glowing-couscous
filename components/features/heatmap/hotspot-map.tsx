"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";

import { WARD_SOURCE, WARDS } from "@/lib/geo/wards";
import { HOTSPOT_RULE } from "@/lib/heatmap/cluster";
import type { HeatmapCluster, HeatmapPoint, HeatmapWard } from "@/lib/heatmap/store";

/**
 * The hotspot map: real ward boundaries on an open basemap, with the pickup heat and
 * the detected sites drawn on top.
 *
 * - **Basemap:** OpenFreeMap's "positron" style — OpenStreetMap data, open-source
 *   tiles, no API key, no usage cap. Greyscale so the only colour on the map is ours.
 * - **Districts:** all of India's 735, from a static file, shaded by pressure
 *   (detections per km², relative to the busiest district) where there are detections.
 * - **Wards:** inside Mumbai, from city zoom in, the 24 BMC boundaries take over,
 *   shaded the same way relative to the busiest ward.
 * - **Heat:** every point in the window, weighted by recency so a site that went quiet
 *   fades instead of lingering. Points arrive snapped to a ~38 m cell by the server.
 * - **Groups:** zoomed out, nearby intakes merge into numbered bubbles (a tap zooms in
 *   until they split); a lone intake is a dot. Past zoom 13 each point is drawn alone.
 * - **Sites:** each hotspot as a true-scale circle of its computed radius, coloured by
 *   status — hazard red when open, copper with a van assigned, green when cleared.
 *
 * MapLibre is loaded in an effect, never during server rendering: it needs WebGL and a
 * window. Its web worker is served from `public/vendor/` because MapLibre 6 otherwise
 * looks for it next to a bundle chunk where it does not exist — see
 * `scripts/vendor-maplibre.mjs`.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAPLIBRE_VERSION = "6.11.2";

/** The design tokens, as MapLibre needs them: canvas paint cannot read CSS variables. */
const COLORS = {
  ink: "#12171b",
  copper: "#a2542a",
  hazard: "#b0311c",
  verified: "#1d5c3c",
  lead: "#5a6470",
};

/**
 * The 3D view. Wards rise by pressure and sites stand as columns by detections, both
 * from the same figures the 2D shading uses, so a flat city means no live data, never
 * a drawing failure. Heights are in metres on a map spanning ~25 km.
 */
const WARD_HEIGHT_PER_PRESSURE_M = 14;
/** Districts are tens of km across, so their columns are scaled to the country view. */
const DISTRICT_HEIGHT_PER_PRESSURE_M = 1_800;

/**
 * India's district outlines, as a static file (public/geo, written by
 * `npm run geo:districts`): MapLibre fetches and parses it in its worker, so ~1 MB of
 * geometry never enters this bundle. Pressure reaches it as feature-state by code.
 */
const DISTRICTS_URL = "/geo/india-districts.geojson";
const DISTRICT_ATTRIBUTION = "Districts © geoBoundaries / LGD (ODbL)";
/** Mumbai's wards take over from its districts from this zoom in. */
const CITY_ZOOM = 9.5;

type Box = { south: number; west: number; north: number; east: number };
const toBounds = (b: Box): [[number, number], [number, number]] => [
  [b.west, b.south],
  [b.east, b.north],
];
const SITE_HEIGHT_PER_DETECTION_M = 110;
/** Last zoom at which intakes are grouped into bubbles; past it each is its own dot (`points-dot`). */
const GROUP_MAX_ZOOM = 13;
const TILT = { pitch: 55, bearing: -18 };

const STATUS_COLOR: Record<HeatmapCluster["status"], string> = {
  open: COLORS.hazard,
  van_assigned: COLORS.copper,
  cleared: COLORS.verified,
};

/** A 48-sided polygon approximating a circle of `radiusM` metres. */
function circle(latitude: number, longitude: number, radiusM: number): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((latitude * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    out.push([longitude + dLng * Math.cos(a), latitude + dLat * Math.sin(a)]);
  }
  return out;
}

function wardFeatures(wards: HeatmapWard[]) {
  const byCode = new Map(wards.map((w) => [w.code, w]));
  return {
    type: "FeatureCollection" as const,
    features: WARDS.map((ward) => {
      const row = byCode.get(ward.code);
      return {
        type: "Feature" as const,
        id: ward.code,
        properties: { code: ward.code, name: ward.name, letter: ward.letter, pressure: row?.pressure ?? 0, detections: row?.detections ?? 0 },
        geometry: { type: "MultiPolygon" as const, coordinates: ward.boundary },
      };
    }),
  };
}

function wardLabels() {
  return {
    type: "FeatureCollection" as const,
    features: WARDS.map((ward) => ({
      type: "Feature" as const,
      properties: { letter: ward.letter },
      geometry: { type: "Point" as const, coordinates: [ward.centroid.longitude, ward.centroid.latitude] },
    })),
  };
}

function pointFeatures(points: HeatmapPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { weight: Math.max(0.15, 1 - p.ageDays / HOTSPOT_RULE.windowDays), hazardous: p.category === "hazardous" ? 1 : 0 },
      geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
    })),
  };
}

function clusterFeatures(clusters: HeatmapCluster[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((c) => ({
      type: "Feature" as const,
      properties: { code: c.code, label: c.label, detections: c.detections, color: STATUS_COLOR[c.status] },
      geometry: { type: "Polygon" as const, coordinates: [circle(c.latitude, c.longitude, Math.max(c.radiusM, 60))] },
    })),
  };
}

export function HotspotMap({
  points,
  clusters,
  wards,
  districts = [],
  frame,
  selected,
  onSelect,
}: {
  points: HeatmapPoint[];
  clusters: HeatmapCluster[];
  wards: HeatmapWard[];
  /** Districts with detections, across India. */
  districts?: { code: string; pressure: number; detections: number }[];
  /** What to open on: the data, or all of India. */
  frame: Box;
  selected?: string | null;
  onSelect?: (code: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [tilted, setTilted] = useState(false);
  const openingFrame = useRef(frame);

  // The map's click handler is registered once; it reads the latest callback through
  // this ref, which is updated after each render rather than during one.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !container.current) return;
        maplibre.setWorkerUrl(`/vendor/maplibre-gl-${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`);

        map = new maplibre.Map({
          container: container.current,
          style: STYLE_URL,
          // The opening view only; later changes reframe (below) without rebuilding.
          bounds: toBounds(openingFrame.current),
          fitBoundsOptions: { padding: 32, maxZoom: 13 },
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          maxZoom: 17,
          minZoom: 3.5,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution: `${DISTRICT_ATTRIBUTION} · ${WARD_SOURCE.attribution} · <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>`,
          }),
          "bottom-right",
        );
        mapRef.current = map;

        map.on("error", (event) => {
          // Tiles can fail one by one on a bad connection; only a style failure is fatal.
          if (!map?.isStyleLoaded()) console.warn("[map]", event.error?.message);
        });

        map.on("load", () => {
          if (!map) return;
          // promoteId: districts are keyed by code for feature-state (pressure, detections).
          map.addSource("districts", { type: "geojson", data: DISTRICTS_URL, promoteId: "code" });
          map.addSource("wards", { type: "geojson", data: wardFeatures([]) });
          map.addSource("ward-labels", { type: "geojson", data: wardLabels() });
          map.addSource("points", { type: "geojson", data: pointFeatures([]) });
          // The same points, grouped on screen: zoomed out, nearby intakes merge into a
          // numbered bubble, so two or three of them read as a group long before they are
          // a hotspot. Display only - sites are still the server's 4-within-150 m rule.
          map.addSource("point-groups", {
            type: "geojson",
            data: pointFeatures([]),
            cluster: true,
            clusterRadius: 44,
            clusterMaxZoom: GROUP_MAX_ZOOM,
          });
          // promoteId: feature-state (the selected outline) is keyed by the string site code.
          map.addSource("clusters", { type: "geojson", data: clusterFeatures([]), promoteId: "code" });

          // India, by district: shaded only where there are detections.
          const hasData = [">", ["coalesce", ["feature-state", "detections"], 0], 0];
          const districtRamp = ["interpolate", ["linear"], ["coalesce", ["feature-state", "pressure"], 0], 0, "#d9dcd2", 50, COLORS.copper, 100, COLORS.hazard];
          map.addLayer({
            id: "district-fill",
            type: "fill",
            source: "districts",
            maxzoom: CITY_ZOOM + 1,
            paint: {
              "fill-color": districtRamp as never,
              "fill-opacity": ["case", hasData, 0.42, 0] as never,
            },
          });
          map.addLayer({
            id: "district-line",
            type: "line",
            source: "districts",
            paint: {
              "line-color": COLORS.ink,
              // Readable at country zoom even with no data: the map must look like India's
              // districts, not like an empty basemap.
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 8, 1],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 9, 0.6],
            },
          });
          map.addLayer({
            id: "district-extrude",
            type: "fill-extrusion",
            source: "districts",
            maxzoom: CITY_ZOOM,
            layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": districtRamp as never,
              "fill-extrusion-height": ["*", ["coalesce", ["feature-state", "pressure"], 0], DISTRICT_HEIGHT_PER_PRESSURE_M] as never,
              "fill-extrusion-opacity": 0.82,
            },
          });

          map.addLayer({
            id: "ward-fill",
            minzoom: CITY_ZOOM - 1,
            type: "fill",
            source: "wards",
            paint: {
              "fill-color": COLORS.ink,
              "fill-opacity": ["interpolate", ["linear"], ["get", "pressure"], 0, 0.02, 100, 0.32],
            },
          });
          map.addLayer({
            id: "ward-line",
            minzoom: CITY_ZOOM - 1,
            type: "line",
            source: "wards",
            paint: { "line-color": COLORS.ink, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.6], "line-opacity": 0.7 },
          });
          // 3D: hidden until tilted. Wards first so site columns draw over them.
          map.addLayer({
            id: "ward-extrude",
            minzoom: CITY_ZOOM,
            type: "fill-extrusion",
            source: "wards",
            layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["get", "pressure"], 0, "#d9dcd2", 50, COLORS.copper, 100, COLORS.hazard],
              "fill-extrusion-height": ["*", ["get", "pressure"], WARD_HEIGHT_PER_PRESSURE_M],
              "fill-extrusion-opacity": 0.78,
              "fill-extrusion-vertical-gradient": true,
            },
          });
          map.addLayer({
            id: "points-heat",
            type: "heatmap",
            source: "points",
            maxzoom: 16,
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2.2],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 13, 18, 16, 34],
              "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.85, 16, 0.25],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(162,84,42,0)",
                0.2, "rgba(240,227,217,0.55)",
                0.45, "rgba(203,138,98,0.75)",
                0.7, COLORS.copper,
                1, COLORS.hazard,
              ],
            },
          });
          map.addLayer({
            id: "points-dot",
            type: "circle",
            source: "points",
            minzoom: 14,
            paint: {
              "circle-radius": 3.5,
              "circle-color": ["case", ["==", ["get", "hazardous"], 1], COLORS.hazard, COLORS.ink],
              "circle-opacity": ["get", "weight"],
              "circle-stroke-width": 1,
              "circle-stroke-color": "#f5f6f1",
            },
          });
          map.addLayer({
            id: "cluster-fill",
            type: "fill",
            source: "clusters",
            paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 },
          });
          map.addLayer({
            id: "cluster-line",
            type: "line",
            source: "clusters",
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 4, 2],
            },
          });
          map.addLayer({
            id: "cluster-extrude",
            type: "fill-extrusion",
            source: "clusters",
            layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["*", ["get", "detections"], SITE_HEIGHT_PER_DETECTION_M],
              "fill-extrusion-opacity": 0.92,
            },
          });
          // Groups and lone intakes, below the zoom where each point is drawn on its own.
          const isGroup = ["has", "point_count"];
          map.addLayer({
            id: "group-bubble",
            type: "circle",
            source: "point-groups",
            maxzoom: GROUP_MAX_ZOOM + 1,
            filter: isGroup as never,
            paint: {
              "circle-color": COLORS.ink,
              "circle-radius": ["step", ["get", "point_count"], 13, 4, 16, 10, 20, 50, 25] as never,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#f5f6f1",
              "circle-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "group-count",
            type: "symbol",
            source: "point-groups",
            maxzoom: GROUP_MAX_ZOOM + 1,
            filter: isGroup as never,
            layout: {
              "text-field": ["get", "point_count_abbreviated"] as never,
              "text-font": ["Noto Sans Bold"],
              "text-size": 12,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#f5f6f1" },
          });
          map.addLayer({
            id: "group-single",
            type: "circle",
            source: "point-groups",
            maxzoom: GROUP_MAX_ZOOM + 1,
            filter: ["!", isGroup] as never,
            paint: {
              "circle-radius": 5,
              "circle-color": ["case", ["==", ["get", "hazardous"], 1], COLORS.hazard, COLORS.ink] as never,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#f5f6f1",
            },
          });

          // A bubble opens to the zoom at which it splits apart.
          map.on("click", "group-bubble", (event: MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            const id = feature?.properties?.cluster_id as number | undefined;
            const source = map?.getSource("point-groups") as GeoJSONSource | undefined;
            if (!map || id === undefined || !source || feature?.geometry.type !== "Point") return;
            const center = feature.geometry.coordinates as [number, number];
            void source
              .getClusterExpansionZoom(id)
              .then((zoom) => map?.easeTo({ center, zoom: Math.min(zoom + 0.25, 17), duration: 600 }))
              .catch(() => map?.easeTo({ center, zoom: map.getZoom() + 2, duration: 600 }));
          });
          for (const layer of ["group-bubble", "group-single"]) {
            map.on("mouseenter", layer, () => {
              if (map) map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layer, () => {
              if (map) map.getCanvas().style.cursor = "";
            });
          }
          map.on("click", "group-single", (event: MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            if (!map || feature?.geometry.type !== "Point") return;
            map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: Math.max(map.getZoom() + 2, 14), duration: 600 });
          });

          map.addLayer({
            id: "ward-letter",
            minzoom: CITY_ZOOM + 0.5,
            type: "symbol",
            source: "ward-labels",
            layout: { "text-field": ["get", "letter"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-allow-overlap": false },
            paint: { "text-color": COLORS.ink, "text-halo-color": "#f5f6f1", "text-halo-width": 1.5 },
          });

          map.on("click", "cluster-fill", (event: MapLayerMouseEvent) => {
            const code = event.features?.[0]?.properties?.code as string | undefined;
            onSelectRef.current?.(code ?? null);
          });
          map.on("mouseenter", "cluster-fill", () => {
            if (map) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "cluster-fill", () => {
            if (map) map.getCanvas().style.cursor = "";
          });

          // Compact attribution opens expanded on a wide map; start it folded so it
          // does not sit over the southern wards. The (i) button still opens it.
          container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");

          setState("ready");
        });
      } catch (error) {
        console.error("[map] failed to start", error);
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Push data whenever it changes (and once the style has loaded).
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    (map.getSource("wards") as GeoJSONSource | undefined)?.setData(wardFeatures(wards));
    const pointData = pointFeatures(points);
    (map.getSource("points") as GeoJSONSource | undefined)?.setData(pointData);
    (map.getSource("point-groups") as GeoJSONSource | undefined)?.setData(pointData);
    (map.getSource("clusters") as GeoJSONSource | undefined)?.setData(clusterFeatures(clusters));
  }, [state, points, clusters, wards]);

  // 2D ↔ 3D: swap the flat shading for extrusions and tilt the camera. Rotation stays
  // off for the user; the bearing here is a fixed, readable three-quarter view.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    const show = (id: string, on: boolean) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    show("ward-extrude", tilted);
    show("district-extrude", tilted);
    show("cluster-extrude", tilted);
    show("ward-fill", !tilted);
    show("district-fill", !tilted);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({
      pitch: tilted ? TILT.pitch : 0,
      bearing: tilted ? TILT.bearing : 0,
      duration: reduced ? 0 : 1400,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
  }, [state, tilted]);

  // District pressure as feature-state. The outlines arrive asynchronously from the
  // static file, so the state is (re)applied whenever that source finishes loading too.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    const apply = () => {
      if (!map.getSource("districts")) return;
      map.removeFeatureState({ source: "districts" });
      for (const d of districts) map.setFeatureState({ source: "districts", id: d.code }, { pressure: d.pressure, detections: d.detections });
    };
    apply();
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (event.sourceId === "districts" && event.isSourceLoaded) apply();
    };
    map.on("sourcedata", onData);
    return () => {
      map.off("sourcedata", onData);
    };
  }, [state, districts]);

  // Reframe when the data's extent changes (a filter, new detections).
  const frameKey = `${frame.south},${frame.west},${frame.north},${frame.east}`;
  const firstFrame = useRef(frameKey);
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map || frameKey === firstFrame.current) return;
    firstFrame.current = frameKey;
    map.fitBounds(toBounds(frame), { padding: 32, maxZoom: 13, duration: 900 });
  }, [state, frameKey, frame]);

  // Selection: thicken the outline, and bring the site into view — but only once the
  // selection has changed. The first render opens on the whole city, which is the
  // briefing view; flying to site #1 on load would hide the pattern the map exists for.
  const firstSelection = useRef(selected);
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    for (const c of clusters) map.setFeatureState({ source: "clusters", id: c.code }, { selected: c.code === selected });
    if (selected === firstSelection.current) return;
    firstSelection.current = undefined;
    const target = clusters.find((c) => c.code === selected);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A camera flight rather than a pan: it pulls back, travels and settles, so the
    // operator keeps their bearings between two sites across the city.
    if (reduce) map.jumpTo({ center: [target.longitude, target.latitude], zoom: Math.max(map.getZoom(), 14) });
    else map.flyTo({ center: [target.longitude, target.latitude], zoom: Math.max(map.getZoom(), 14.5), speed: 1.1, curve: 1.5, essential: false });
  }, [state, selected, clusters]);

  // A pulse on every detected site, so a hotspot reads as live rather than as a shape.
  // HTML markers, not a repainted layer: the pulse is CSS, and costs the GPU nothing
  // while the map is idle.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    let cancelled = false;
    const markers: { remove: () => void }[] = [];
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled) return;
      for (const c of clusters) {
        const element = document.createElement("div");
        element.className = "site-pulse";
        element.style.setProperty("--pulse", STATUS_COLOR[c.status]);
        element.setAttribute("aria-hidden", "true");
        markers.push(new maplibre.Marker({ element }).setLngLat([c.longitude, c.latitude]).addTo(map));
      }
    });
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
    };
  }, [state, clusters]);

  return (
    <div className="relative aspect-[4/3] w-full border border-ink bg-paper-raised">
      {/* Inline, not a class: MapLibre's stylesheet sets `.maplibregl-map { position:
          relative }` on this element, which would beat `absolute inset-0` and collapse
          the map to zero height. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {state === "ready" && points.length === 0 && clusters.length === 0 ? (
        // Said on the map itself, so an empty map never reads as a broken one.
        <div className="pointer-events-none absolute inset-x-3 bottom-10 flex justify-center">
          <p className="max-w-md border-2 border-ink bg-paper-raised/95 px-4 py-2.5 text-center text-[12px] leading-snug text-ink">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-copper">No geotagged intakes yet</span>
            Submit an intake with <span className="font-medium">Add location</span> and it appears here, filed to its
            district.
          </p>
        </div>
      ) : null}
      {state === "ready" ? (
        <button
          type="button"
          onClick={() => setTilted((t) => !t)}
          aria-pressed={tilted}
          className="absolute left-3 top-3 border-2 border-ink bg-paper-raised px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-paper aria-pressed:bg-ink aria-pressed:text-paper"
        >
          {tilted ? "Flat view" : "3D view"}
        </button>
      ) : null}
      {state !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-xs font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            {state === "loading"
              ? "Loading the map…"
              : "The map could not start (WebGL or the tile server is unavailable). The tables below carry the same data."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
