import { createHash } from "node:crypto";

type Flight = { promise: Promise<unknown>; expiresAt: number };
const shared = globalThis as typeof globalThis & { __qsRefreshFlights?: Map<string, Flight> };
const flights = shared.__qsRefreshFlights ??= new Map<string, Flight>();

/** Coalesce rotating refresh tokens across concurrent BFF routes and overlapping responses. */
export function refreshSingleFlight<T>(refreshToken: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [key, flight] of flights) if (flight.expiresAt <= now) flights.delete(key);
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const existing = flights.get(key);
  if (existing) return existing.promise as Promise<T>;
  if (flights.size >= 256) return Promise.reject(new Error("Refresh capacity reached"));
  const flight: Flight = { promise: Promise.resolve(), expiresAt: now + 30000 };
  flight.promise = Promise.resolve().then(load).then(result => {
    flight.expiresAt = Date.now() + 5000;
    return result;
  }, error => {
    flights.delete(key);
    throw error;
  });
  flights.set(key, flight);
  return flight.promise as Promise<T>;
}
