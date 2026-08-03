"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ROADBOOK_BY_ID } from "@/lib/blocks";

// Map for composing a bolletje-pijltje roadbook: draw the turn points between a
// leg's start and end; distance + direction per step are derived from geometry.
export interface RoadbookMapProps {
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  turnPoints: { lat: number; lng: number }[];
  dirs: string[]; // derived direction id per turn point (for the arrow icon)
  route?: [number, number][]; // road-snapped geometry; falls back to straight lines
  addMode: boolean;
  height?: number;
  onAddPoint: (lat: number, lng: number) => void;
  onMovePoint: (i: number, lat: number, lng: number) => void;
}

const NL_CENTER: [number, number] = [52.12, 5.29];

function endIcon(label: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}
function turnIcon(n: number, dir: string) {
  const icon = ROADBOOK_BY_ID[dir]?.icon ?? "•";
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="font-size:20px;line-height:1">${icon}</div><div style="width:16px;height:16px;border-radius:50%;background:#534AB7;border:2px solid #fff;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">${n}</div></div>`,
    iconSize: [24, 34],
    iconAnchor: [12, 30],
  });
}

export default function RoadbookMap({
  start,
  end,
  turnPoints,
  dirs,
  route,
  addMode,
  height = 340,
  onAddPoint,
  onMovePoint,
}: RoadbookMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const cb = useRef({ addMode, onAddPoint });
  cb.current = { addMode, onAddPoint };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(NL_CENTER, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cb.current.addMode) cb.current.onAddPoint(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) containerRef.current.style.cursor = addMode ? "crosshair" : "";
  }, [addMode]);

  // When the container is resized (e.g. entering/leaving full-screen edit),
  // Leaflet must be told or it keeps the old size and loads tiles slowly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [height]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const path: [number, number][] = [];
    if (start) path.push([start.lat, start.lng]);
    for (const t of turnPoints) path.push([t.lat, t.lng]);
    if (end) path.push([end.lat, end.lng]);

    // Prefer the road-snapped geometry; otherwise draw straight lines.
    const line = route && route.length >= 2 ? route : path;
    if (line.length >= 2) {
      L.polyline(line, { color: "#534AB7", weight: 5, opacity: 0.9 }).addTo(layer);
    }
    if (start) L.marker([start.lat, start.lng], { icon: endIcon("S", "#1D9E75") }).addTo(layer);
    if (end) L.marker([end.lat, end.lng], { icon: endIcon("E", "#D85A30") }).addTo(layer);

    turnPoints.forEach((t, i) => {
      const marker = L.marker([t.lat, t.lng], { icon: turnIcon(i + 1, dirs[i] ?? "straight"), draggable: true }).addTo(layer);
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        onMovePoint(i, Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
      });
    });

    if (!fittedRef.current && line.length > 0) {
      map.fitBounds(L.latLngBounds(line).pad(0.4), { maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [start, end, turnPoints, dirs, route, onMovePoint]);

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: 12, zIndex: 0 }} />;
}
