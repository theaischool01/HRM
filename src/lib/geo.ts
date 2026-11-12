/** Client-safe geo helpers shared by the check-in UI and the server-side gate. */

export type Coords = { latitude: number; longitude: number; accuracy?: number | null };

export type OfficeLocation = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
};

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Coords, b: { latitude: number; longitude: number }): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearest configured office and whether the reading falls inside its radius. */
export function nearestOffice(coords: Coords, offices: OfficeLocation[]) {
  const active = offices.filter((o) => o.is_active);
  const first = active[0];
  if (!first) return null;
  let best: { office: OfficeLocation; distance: number } = {
    office: first,
    distance: distanceMeters(coords, first),
  };
  for (const office of active.slice(1)) {
    const distance = distanceMeters(coords, office);
    if (distance < best.distance) best = { office, distance };
  }
  return { ...best, withinRadius: best.distance <= Number(best.office.radius_meters) };
}

export const LOCATION_STATUS_LABELS: Record<string, string> = {
  verified: "Location verified",
  not_required: "Not required for this work mode",
  not_provided: "Not provided",
  failed: "Outside office radius",
};

/** Work modes that must be proven on-site. */
export const LOCATION_REQUIRED_MODES = ["wfo"] as const;
export const requiresLocation = (mode: string) =>
  (LOCATION_REQUIRED_MODES as readonly string[]).includes(mode);

export type VerifiedLocationEvidence = {
  location_status: "verified";
  location_latitude: number;
  location_longitude: number;
  location_accuracy_m: number | null;
  location_distance_m: number;
  office_location_id: string;
};

/**
 * Pure server/client geofence validator for WFO check-in:
 * - Rejects check-in when 0 active offices are configured (never falls back to 'not_provided').
 * - Rejects missing or out-of-range coordinates.
 * - Rejects coordinates outside the nearest active office's radius.
 */
export function evaluateWfoGeofence(
  reading: { latitude?: unknown; longitude?: unknown; accuracy?: unknown } | null | undefined,
  offices: OfficeLocation[],
): VerifiedLocationEvidence {
  const activeOffices = offices.filter((o) => o.is_active);
  if (activeOffices.length === 0) {
    throw new Error(
      "Office check-in is unavailable because no active office geofence is configured. Contact your administrator.",
    );
  }

  const lat = reading == null ? NaN : Number(reading.latitude);
  const lng = reading == null ? NaN : Number(reading.longitude);

  if (
    !reading ||
    reading.latitude == null ||
    reading.longitude == null ||
    reading.latitude === "" ||
    reading.longitude === "" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(
      "Location access is required to check in as Work from office. Allow location access, or pick a different work mode if you are not on-site.",
    );
  }

  const accuracy =
    reading.accuracy == null || reading.accuracy === "" || !Number.isFinite(Number(reading.accuracy))
      ? null
      : Number(reading.accuracy);

  const coords: Coords = { latitude: lat, longitude: lng, accuracy };
  const match = nearestOffice(coords, activeOffices);
  if (!match || !match.withinRadius) {
    throw new Error(
      `You appear to be outside the office (about ${Math.round(match?.distance ?? 0)} m from ${match?.office.name ?? "the office"}, allowed ${match?.office.radius_meters ?? 0} m). Please select a different work mode if you're not on-site, or contact your admin if this is incorrect.`,
    );
  }

  return {
    location_status: "verified",
    location_latitude: coords.latitude,
    location_longitude: coords.longitude,
    location_accuracy_m: accuracy,
    location_distance_m: Math.round(match.distance * 10) / 10,
    office_location_id: match.office.id,
  };
}

/**
 * Pure WFH authorization validator:
 * Allows WFH check-in ONLY when the employee holds at least one active remote/hybrid
 * project allocation OR has an approved WFH request covering today's IST work date.
 */
export function evaluateWfhAuthorization(args: {
  projectWorkModes: readonly (string | null | undefined)[];
  hasApprovedWfhToday: boolean;
}): true {
  if (args.hasApprovedWfhToday) return true;
  const hasRemoteCapableProject = args.projectWorkModes.some(
    (mode) => mode === "remote" || mode === "hybrid",
  );
  if (hasRemoteCapableProject) return true;

  throw new Error(
    "Work from home requires an approved WFH request for today or a remote/hybrid project assignment.",
  );
}

/** Reads the device position once, with a sane timeout for indoor GPS. */
export function readBrowserPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This device cannot share a location, so office check-in is unavailable."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location access is required to check in as Work from office. Allow location, or pick a different work mode."
              : "We could not read your location. Move near a window or try again, or pick a different work mode.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}
