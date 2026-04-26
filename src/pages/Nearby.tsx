import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, LocateFixed, Loader2, MapPin } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useUserLocation } from "@/hooks/useUserLocation";
import { useProviderLocations, type ProviderLocation } from "@/hooks/useProviderLocations";
import { ProviderBottomSheet } from "@/components/map/ProviderBottomSheet";
import { getInitials } from "@/lib/geo";
import { saveMapView, loadMapView } from "@/lib/mapCache";
import { toast } from "sonner";

const DEFAULT_CENTER: [number, number] = [32.0853, 34.7818];
const DEFAULT_ZOOM = 11;
const USER_ZOOM = 14;
const FRESH_THRESHOLD_MS = 30_000;

// User location pin: solid accent circle with pulsing outer ring
const USER_PIN = L.divIcon({
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `<div style="position:relative;width:24px;height:24px">
    <div class="user-pin-pulse" style="position:absolute;inset:0;border-radius:50%;background:hsl(24,80%,55%);opacity:0.35;"></div>
    <div style="position:absolute;top:4px;left:4px;width:16px;height:16px;border-radius:50%;background:hsl(24,80%,55%);border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
  </div>`,
});

// Minimal HTML escape for values injected into DivIcon HTML strings
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}

/**
 * Returns a Leaflet DivIcon for a provider marker.
 *
 * Normal state:  2px accent ring, scale(1), lighter shadow
 * Selected state: 3px accent ring, scale(1.1), heavier shadow, zIndexOffset 1000
 *
 * iconSize and iconAnchor are identical for both states so the map anchor
 * position never jumps when a marker transitions between states.
 *
 * NOTE: Leaflet replaces the entire DivIcon DOM node when the icon prop changes,
 * so the CSS transition defined on .avatar-marker-icon may not animate between
 * states (known DivIcon limitation). The change is still visually clean — instant
 * scale is preferable to a broken tween.
 *
 * Future optimisation: for larger provider counts, memoize createAvatarPin per
 * (providerId, isSelected) using useMemo to avoid icon recreation on every render.
 */
function createAvatarPin(provider: ProviderLocation, isSelected: boolean): L.DivIcon {
  const initials = esc(getInitials(provider.business_name));
  const ring = isSelected ? "3px" : "2px";
  const shadow = isSelected
    ? "0 4px 16px rgba(0,0,0,0.35)"
    : "0 2px 8px rgba(0,0,0,0.25)";
  const scale = isSelected ? "scale(1.1)" : "scale(1)";

  const imgHtml = provider.avatar_image
    ? `<img src="${esc(provider.avatar_image)}" loading="lazy" alt=""
         onerror="this.style.display='none'"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;z-index:1;"/>`
    : "";

  return L.divIcon({
    className: "avatar-marker-icon",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<div style="
      position:relative;
      width:48px;height:48px;
      border-radius:50%;
      background:hsl(220,15%,13%);
      border:${ring} solid hsl(24,80%,55%);
      box-shadow:${shadow};
      overflow:hidden;
      display:flex;align-items:center;justify-content:center;
      transform:${scale};
      transition:transform 0.2s ease,box-shadow 0.2s ease;
      font-size:15px;font-weight:600;color:white;letter-spacing:-0.01em;
      user-select:none;
    "><span style="position:relative;z-index:0;pointer-events:none;">${initials}</span>${imgHtml}</div>`,
  });
}

/**
 * Flies to the user's position whenever it changes.
 *
 * skipInitialFly: when true (map was restored from sessionStorage cache), the
 * FIRST automatic position change is suppressed so the cached view wins.
 * The user can still recenter manually via the Locate Me button — that triggers
 * a new locate() call, which produces a second position change, and by then
 * hasSkippedInitial.current is true so the skip branch is never re-entered.
 */
function FlyToUser({
  position,
  skipInitialFly,
}: {
  position: GeolocationCoordinates | null;
  skipInitialFly: boolean;
}) {
  const map = useMap();
  const prevRef = useRef<GeolocationCoordinates | null>(null);
  const hasSkippedInitial = useRef(false);

  useEffect(() => {
    if (position && position !== prevRef.current) {
      prevRef.current = position;
      if (skipInitialFly && !hasSkippedInitial.current) {
        hasSkippedInitial.current = true;
        return; // cached view wins; don't auto-fly on this visit
      }
      map.flyTo([position.latitude, position.longitude], USER_ZOOM, { animate: true, duration: 1.5 });
    }
  }, [position, map, skipInitialFly]);

  return null;
}

// Saves the map view to sessionStorage after each pan/zoom (debounced 200 ms)
function PersistMapView() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = useMapEvents({
    moveend: () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const c = map.getCenter();
        saveMapView([c.lat, c.lng], map.getZoom());
      }, 200);
    },
  });

  // Clean up pending timer on unmount
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return null;
}

// Captures the map instance so the locate-me button can call flyTo directly
function CaptureMap({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  return null;
}

export default function NearbyPage() {
  const navigate = useNavigate();
  const { t, isRtl } = useLang();
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // Read cache once on mount (lazy initializer — synchronous, runs before first render)
  const [mapInit] = useState(() => {
    const cached = loadMapView();
    return {
      center: cached?.center ?? DEFAULT_CENTER,
      zoom:   cached?.zoom   ?? DEFAULT_ZOOM,
      restoredFromCache: cached !== null,
    };
  });

  const { position, isLocating, errorCode, lastFetched, locate } = useUserLocation({ immediate: true });
  const { locations, isLoading: isLoadingLocations } = useProviderLocations();

  const selectedProvider = locations.find((l) => l.id === selectedProviderId) ?? null;

  // Show one toast per failed geolocation attempt (errorCode resets to null before each call)
  useEffect(() => {
    if (errorCode === null) return;
    if (errorCode === -1) toast.error(t("locationErrorUnsupported"));
    else if (errorCode === 1) toast.error(t("locationErrorDenied"));
    else if (errorCode === 2) toast.error(t("locationErrorUnavailable"));
    else if (errorCode === 3) toast.error(t("locationErrorTimeout"));
  }, [errorCode, t]);

  const handleLocateMe = () => {
    if (position && lastFetched && Date.now() - lastFetched < FRESH_THRESHOLD_MS) {
      // Position is fresh — re-centre without a new browser API call
      map?.flyTo([position.latitude, position.longitude], USER_ZOOM, { animate: true });
    } else {
      locate();
    }
  };

  // RTL-aware overlay positions
  const backPos  = isRtl ? "top-4 right-4" : "top-4 left-4";
  const locatePos = isRtl ? "top-4 left-4"  : "top-4 right-4";
  const BackIcon  = isRtl ? ChevronRight : ChevronLeft;

  return (
    <div className="relative h-screen w-full overflow-hidden">

      {/* Back button */}
      <button
        aria-label={t("nearby")}
        onClick={() => navigate(-1)}
        className={`absolute z-[1000] ${backPos} bg-card border border-border rounded-full p-2 shadow-md active:scale-95 transition-transform`}
      >
        <BackIcon className="h-5 w-5" />
      </button>

      {/* Locate-me button */}
      <button
        aria-label={t("locateMe")}
        onClick={handleLocateMe}
        disabled={isLocating}
        className={`absolute z-[1000] ${locatePos} bg-card border border-border rounded-full p-2 shadow-md active:scale-95 transition-transform disabled:opacity-60`}
      >
        {isLocating
          ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          : <LocateFixed className="h-5 w-5 text-accent" />
        }
      </button>

      {/* Detecting indicator — top centre */}
      {isLocating && (
        <div className="absolute z-[1000] top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-full px-4 py-2 flex items-center gap-2 shadow-md">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs font-medium">{t("locationDetecting")}</span>
        </div>
      )}

      <MapContainer
        center={mapInit.center}
        zoom={mapInit.zoom}
        className="h-full w-full z-0"
        zoomControl={false}
        scrollWheelZoom
        tap={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        <PersistMapView />
        <CaptureMap onMap={setMap} />
        <FlyToUser position={position} skipInitialFly={mapInit.restoredFromCache} />

        {position && (
          <Marker position={[position.latitude, position.longitude]} icon={USER_PIN} />
        )}

        {/* Avatar markers — icon and zIndexOffset update reactively when selectedProviderId changes.
            React-leaflet calls marker.setIcon() and marker.setZIndexOffset() on the Leaflet
            instance, so only changed markers are touched in the DOM. */}
        <MarkerClusterGroup chunkedLoading>
          {locations.map((provider) => {
            const isSelected = provider.id === selectedProviderId;
            return (
              <Marker
                key={provider.id}
                position={[provider.latitude, provider.longitude]}
                icon={createAvatarPin(provider, isSelected)}
                zIndexOffset={isSelected ? 1000 : 0}
                eventHandlers={{ click: () => setSelectedProviderId(provider.id) }}
              />
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Empty state overlay */}
      {!isLoadingLocations && locations.length === 0 && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div
            className="bg-card border border-border rounded-2xl p-6 text-center shadow-lg max-w-xs mx-4 pointer-events-auto space-y-1"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="font-semibold text-sm">{t("nearbyNoProviders")}</p>
            <p className="text-xs text-muted-foreground">{t("nearbyNoProvidersSubtext")}</p>
          </div>
        </div>
      )}

      {/* Bottom sheet — stays mounted; content switches on selectedProviderId change
          without close/reopen flash because the Drawer never unmounts between selections */}
      <ProviderBottomSheet
        provider={selectedProvider}
        open={selectedProviderId !== null}
        onClose={() => setSelectedProviderId(null)}
        userPosition={position}
      />
    </div>
  );
}
