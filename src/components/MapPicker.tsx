import { useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { MapPin, X } from "lucide-react";

type LatLng = { lat: number; lng: number } | null;

function loadLeaflet() {
  return import("leaflet").then((m) => m.default ?? m);
}

function makeIcon(L: any) {
  return L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
}

export function MapPicker({
  value,
  onChange,
  defaultCenter = { lat: 24.7136, lng: 46.6753 },
  height = 320,
}: {
  value: LatLng;
  onChange: (v: LatLng) => void;
  defaultCenter?: { lat: number; lng: number };
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let mounted = true;
    loadLeaflet().then((L) => {
      if (!mounted || !containerRef.current) return;
      LRef.current = L;
      const start = value ?? defaultCenter;
      const map = L.map(containerRef.current).setView([start.lat, start.lng], value ? 15 : 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      map.on("click", (e: any) => place(e.latlng.lat, e.latlng.lng));
      if (value) place(value.lat, value.lng);
    });
    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function place(lat: number, lng: number) {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const m = L.marker([lat, lng], { icon: makeIcon(L), draggable: true }).addTo(map);
      m.on("dragend", () => {
        const p = m.getLatLng();
        onChange({ lat: p.lat, lng: p.lng });
      });
      markerRef.current = m;
    }
    onChange({ lat, lng });
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      mapRef.current?.setView([latitude, longitude], 15);
      place(latitude, longitude);
    });
  }

  function clear() {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={useMyLocation}>
          <MapPin className="ms-1 h-4 w-4" /> موقعي الحالي
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            <X className="ms-1 h-4 w-4" /> مسح
          </Button>
        )}
        {value && (
          <span className="text-xs text-muted-foreground">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full overflow-hidden rounded-lg border" />
      <p className="text-xs text-muted-foreground">انقر على الخريطة لوضع علامة، أو اسحبها لتعديل الموقع.</p>
    </div>
  );
}

export function MapView({
  items,
  onSelect,
  height = 500,
}: {
  items: Array<{ id: string; latitude: number | null; longitude: number | null; title: string; status: string }>;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const points = useMemo(
    () => items.filter((i) => typeof i.latitude === "number" && typeof i.longitude === "number"),
    [items],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let mounted = true;
    loadLeaflet().then((L) => {
      if (!mounted || !containerRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current).setView([24.7136, 46.6753], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      renderPoints();
    });
    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    renderPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  function renderPoints() {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (points.length === 0) return;
    const ic = makeIcon(L);
    const markers = points.map((p) => {
      const m = L.marker([p.latitude!, p.longitude!], { icon: ic });
      m.bindPopup(
        `<strong>${escapeHtml(p.title)}</strong><br/><button data-id="${p.id}" class="lvbl-popup-btn" style="margin-top:6px;color:#2563eb;text-decoration:underline">عرض التفاصيل</button>`,
      );
      m.on("popupopen", (e: any) => {
        const el = (e.popup.getElement() as HTMLElement | null)?.querySelector<HTMLButtonElement>(".lvbl-popup-btn");
        if (el) el.onclick = () => onSelect?.(p.id);
      });
      return m;
    });
    markers.forEach((m: any) => m.addTo(layer));
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2));
  }

  return (
    <div>
      <div ref={containerRef} style={{ height }} className="w-full overflow-hidden rounded-xl border" />
      {points.length === 0 && (
        <p className="mt-2 text-center text-sm text-muted-foreground">لا توجد شكاوى بإحداثيات على الخريطة.</p>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
