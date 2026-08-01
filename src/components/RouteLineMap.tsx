"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Read-only map for "de harde lijn": shows the start, the end and the fixed
// route line the team must follow by map alone. There is deliberately NO live
// position marker — the GPS does not guide here (old-school map reading).
export interface RouteLineMapProps {
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  route: [number, number][]; // the drawn line (falls back to a straight start→end)
  trail?: [number, number][]; // the team's actual gps trail (feedback afterwards)
  height?: number;
}

const NL_CENTER: [number, number] = [52.12, 5.29];

function dotIcon(label: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function RouteLineMap({ start, end, route, trail, height = 320 }: RouteLineMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true }).setView(NL_CENTER, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const straight: [number, number][] = [];
    if (start) straight.push([start.lat, start.lng]);
    if (end) straight.push([end.lat, end.lng]);
    const line = route && route.length >= 2 ? route : straight;

    if (line.length >= 2) {
      L.polyline(line, { color: "#534AB7", weight: 5, opacity: 0.95 }).addTo(layer);
    }
    // The team's driven trail, shown afterwards as a dashed coral line on top.
    if (trail && trail.length >= 2) {
      L.polyline(trail, { color: "#D85A30", weight: 4, opacity: 0.9, dashArray: "6 6" }).addTo(layer);
    }
    if (start) L.marker([start.lat, start.lng], { icon: dotIcon("S", "#1D9E75") }).addTo(layer);
    if (end) L.marker([end.lat, end.lng], { icon: dotIcon("F", "#D85A30") }).addTo(layer);

    const fit = [...line, ...(trail ?? [])];
    if (!fittedRef.current && fit.length > 0) {
      map.fitBounds(L.latLngBounds(fit).pad(0.3), { maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [start, end, route, trail]);

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: 12, zIndex: 0 }} />;
}
