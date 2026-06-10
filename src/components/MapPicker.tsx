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
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-lg border"
      />
      <p className="text-xs text-muted-foreground">
        انقر على الخريطة لوضع علامة، أو اسحبها لتعديل الموقع.
      </p>
    </div>
  );
}

export function MapView({
  items,
  onSelect,
  height = 500,
}: {
  items: Array<{
    id: string;
    complaint_number?: string | null;
    latitude: number | null;
    longitude: number | null;
    title: string;
    status: string;
  }>;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const points = useMemo(
    () => items.filter((i) => typeof i.latitude === "number" && typeof i.longitude === "number"),
    [items],
  );

  // Group points by rounded coordinates for clustering
  const groups = useMemo(() => {
    const map = new Map<string, typeof points>();
    for (const p of points) {
      const key = `${p.latitude!.toFixed(5)},${p.longitude!.toFixed(5)}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.values());
  }, [points]);

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
  }, [groups]);

  function renderPoints() {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (groups.length === 0) return;
    const ic = makeIcon(L);
    const markers: any[] = [];
    for (const group of groups) {
      const first = group[0];
      const count = group.length;
      const marker =
        count > 1
          ? L.marker([first.latitude!, first.longitude!], {
              icon: L.divIcon({
                className: "lvbl-cluster-icon",
                html: `<div style="background:#2563eb;color:#fff;border-radius:9999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3)">${count}</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              }),
            })
          : L.marker([first.latitude!, first.longitude!], { icon: ic });

      const popup = document.createElement("div");
      popup.style.maxWidth = "260px";
      popup.innerHTML = `<strong>${count > 1 ? `${count} شكاوى في هذا الموقع` : "تفاصيل الشكوى"}</strong>`;
      const list = document.createElement("ul");
      list.style.listStyle = "none";
      list.style.padding = "0";
      list.style.margin = "8px 0 0";
      group.forEach((p) => {
        const item = document.createElement("li");
        item.style.margin = "6px 0";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lvbl-popup-btn";
        button.style.cssText =
          "width:100%;text-align:right;color:#2563eb;text-decoration:underline;cursor:pointer;background:none;border:0;padding:2px 0;font:inherit";
        button.innerHTML = `<div style="font-family:monospace;font-size:11px;color:#6b7280">${escapeHtml(
          p.complaint_number ?? "",
        )}</div><div>${escapeHtml(p.title)}</div><div style="font-size:11px;color:#6b7280">${escapeHtml(
          p.status,
        )}</div>`;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelectRef.current?.(p.id);
          map.closePopup();
        });
        item.appendChild(button);
        list.appendChild(item);
      });
      popup.appendChild(list);
      L.DomEvent.disableClickPropagation(popup);
      marker.bindPopup(popup);
      markers.push(marker);
    }
    markers.forEach((m: any) => m.addTo(layer));
    const featureGroup = L.featureGroup(markers);
    map.fitBounds(featureGroup.getBounds().pad(0.2));
  }

  return (
    <div>
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-xl border"
      />
      {points.length === 0 && (
        <p className="mt-2 text-center text-sm text-muted-foreground">
          لا توجد شكاوى بإحداثيات على الخريطة.
        </p>
      )}
    </div>
  );
}


function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
