"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ============================================================================
// Real interactive map (OpenStreetMap tiles via Leaflet — free, no API key).
// Used by the designer editor (place/move/select points) and the live view
// (team positions). Must be loaded client-only (next/dynamic ssr:false),
// because Leaflet needs `window`.
// ============================================================================

export type MapPoint = {
  id: string;
  lat: number | null;
  lng: number | null;
  label: string;
  kind: "start" | "waypoint" | "finish";
};

export type MapTeam = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color: string;
};

export interface RallyMapProps {
  points: MapPoint[];
  selectedId?: string | null;
  editable?: boolean;
  addMode?: boolean;
  teams?: MapTeam[];
  height?: number;
  onAddPoint?: (lat: number, lng: number) => void;
  onSelectPoint?: (id: string) => void;
  onMovePoint?: (id: string, lat: number, lng: number) => void;
}

const NL_CENTER: [number, number] = [52.12, 5.29];

function pointIcon(p: MapPoint, selected: boolean) {
  const color = p.kind !== "waypoint" ? "#D85A30" : "#1D9E75";
  const size = selected ? 34 : 28;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${selected ? "#123B2E" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">${p.label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function teamIcon(t: MapTeam) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:18px;height:18px;border-radius:50%;background:${t.color};border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div><span style="font-size:10px;font-weight:700;color:#123B2E;background:rgba(255,255,255,.8);border-radius:4px;padding:0 3px;margin-top:1px;white-space:nowrap">${t.name}</span></div>`,
    iconSize: [18, 34],
    iconAnchor: [9, 9],
  });
}

export default function RallyMap({
  points,
  selectedId,
  editable = false,
  addMode = false,
  teams = [],
  height = 420,
  onAddPoint,
  onSelectPoint,
  onMovePoint,
}: RallyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  // Keep latest callbacks/flags in refs so the map click handler isn't stale.
  const cb = useRef({ addMode, onAddPoint });
  cb.current = { addMode, onAddPoint };

  // init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(NL_CENTER, 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cb.current.addMode && cb.current.onAddPoint) {
        cb.current.onAddPoint(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
      }
    });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Leaflet needs a size recalcalc once the container is laid out.
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // reflect add-mode cursor
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor = addMode ? "crosshair" : "";
    }
  }, [addMode]);

  // pan/zoom to the selected point (e.g. picked from the list in the editor)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const p = points.find((x) => x.id === selectedId);
    if (p && p.lat != null && p.lng != null) {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    }
    // only react to selection changes, not every points refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // redraw markers / route / teams when data changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const coords = points
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => [p.lat as number, p.lng as number] as [number, number]);

    // route line
    if (coords.length >= 2) {
      L.polyline(coords, { color: "#1D9E75", weight: 4, dashArray: "9 7", opacity: 0.9 }).addTo(layer);
    }

    // point markers
    for (const p of points) {
      if (p.lat == null || p.lng == null) continue;
      const marker = L.marker([p.lat, p.lng], {
        icon: pointIcon(p, p.id === selectedId),
        draggable: editable,
      }).addTo(layer);
      marker.on("click", () => onSelectPoint?.(p.id));
      if (editable) {
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          onMovePoint?.(p.id, Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
        });
      }
    }

    // team markers (live view)
    for (const t of teams) {
      L.marker([t.lat, t.lng], { icon: teamIcon(t), interactive: false }).addTo(layer);
    }

    // fit bounds once when we first have coordinates
    if (!fittedRef.current && coords.length > 0) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds.pad(0.3), { maxZoom: 15 });
      fittedRef.current = true;
    }
  }, [points, teams, selectedId, editable, onSelectPoint, onMovePoint]);

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: 12, zIndex: 0 }} />;
}
