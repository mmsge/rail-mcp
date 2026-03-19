import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';
import { parseStringPromise } from 'xml2js';

const BASE = 'https://xmlopen.rejseplanen.dk/bin/rest.exe';

interface RPStop {
  $: { id: string; extId?: string; name: string; lon?: string; lat?: string };
}

interface RPDeparture {
  $: {
    name: string;
    type?: string;
    stop: string;
    time: string;
    date?: string;
    rtTime?: string;
    rtDate?: string;
    direction?: string;
    track?: string;
    rtTrack?: string;
    cancelled?: string;
    operator?: string;
  };
}

interface RPLeg {
  $: {
    name?: string;
    type?: string;
    cancelled?: string;
    track?: string;
  };
  Origin?: Array<{ $: { name: string; time?: string; rtTime?: string } }>;
  Destination?: Array<{ $: { name: string; time?: string; rtTime?: string } }>;
}

export class DenmarkAdapter extends RailAdapter {
  readonly country: Country = 'DK';
  readonly name = 'Rejseplanen (Denmark)';

  isAvailable(): boolean {
    return true; // No API key required
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${BASE}/location?input=${encodeURIComponent(query)}&format=xml`;
    const xml = await this.fetchText(url);
    const parsed = await parseStringPromise(xml);
    const stops: RPStop[] = parsed?.LocationList?.StopLocation ?? [];
    return stops.map(s => ({
      id: s.$.extId ?? s.$.id,
      name: s.$.name,
      country: this.country,
      lat: s.$.lat ? parseFloat(s.$.lat) / 1_000_000 : undefined,
      lon: s.$.lon ? parseFloat(s.$.lon) / 1_000_000 : undefined,
    }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/departureBoard?id=${encodeURIComponent(stationId)}&format=xml`;
    const xml = await this.fetchText(url);
    const parsed = await parseStringPromise(xml);
    const deps: RPDeparture[] = parsed?.DepartureBoard?.Departure ?? [];
    return deps.slice(0, limit).map(d => this.mapDeparture(d));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/arrivalBoard?id=${encodeURIComponent(stationId)}&format=xml`;
    const xml = await this.fetchText(url);
    const parsed = await parseStringPromise(xml);
    const arrivals: RPDeparture[] = parsed?.ArrivalBoard?.Arrival ?? [];
    return arrivals.slice(0, limit).map(d => this.mapArrival(d));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const date = datetime.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Copenhagen' }).replace(/\//g, '.');
    const time = datetime.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen', hour12: false });
    const url = `${BASE}/trip?originId=${encodeURIComponent(originId)}&destId=${encodeURIComponent(destId)}&date=${date}&time=${time}&format=xml`;
    const xml = await this.fetchText(url);
    const parsed = await parseStringPromise(xml);
    const trips = parsed?.TripList?.Trip ?? [];
    return trips.map((t: { Leg?: RPLeg[] }) => this.mapTrip(t));
  }

  private mapDeparture(d: RPDeparture): TrainService {
    const scheduled = d.$.time?.slice(0, 5) ?? 'Unknown';
    const actual = d.$.rtTime?.slice(0, 5);
    return {
      trainNumber: d.$.name,
      operator: d.$.operator,
      origin: d.$.stop,
      destination: d.$.direction ?? 'Unknown',
      scheduledTime: scheduled,
      actualTime: actual && actual !== scheduled ? actual : undefined,
      delayMinutes: this.delayMinutes(scheduled, actual),
      platform: d.$.rtTrack ?? d.$.track,
      isCancelled: d.$.cancelled === 'true',
      country: this.country,
    };
  }

  private mapArrival(d: RPDeparture): TrainService {
    const scheduled = d.$.time?.slice(0, 5) ?? 'Unknown';
    const actual = d.$.rtTime?.slice(0, 5);
    return {
      trainNumber: d.$.name,
      operator: d.$.operator,
      origin: d.$.direction ?? 'Unknown',
      destination: d.$.stop,
      scheduledTime: scheduled,
      actualTime: actual && actual !== scheduled ? actual : undefined,
      delayMinutes: this.delayMinutes(scheduled, actual),
      platform: d.$.rtTrack ?? d.$.track,
      isCancelled: d.$.cancelled === 'true',
      country: this.country,
    };
  }

  private mapTrip(t: { Leg?: RPLeg[] }): Journey {
    const legs: JourneyLeg[] = (t.Leg ?? []).map(l => ({
      origin: l.Origin?.[0]?.$.name ?? 'Unknown',
      destination: l.Destination?.[0]?.$.name ?? 'Unknown',
      departureTime: l.Origin?.[0]?.$.rtTime ?? l.Origin?.[0]?.$.time ?? 'Unknown',
      arrivalTime: l.Destination?.[0]?.$.rtTime ?? l.Destination?.[0]?.$.time ?? 'Unknown',
      trainNumber: l.$.name ?? 'Unknown',
      platform: l.$.track,
    }));

    const first = t.Leg?.[0];
    const last = t.Leg?.[t.Leg.length - 1];
    const dep = first?.Origin?.[0]?.$.rtTime ?? first?.Origin?.[0]?.$.time ?? '';
    const arr = last?.Destination?.[0]?.$.rtTime ?? last?.Destination?.[0]?.$.time ?? '';

    return {
      departureTime: dep.slice(0, 5),
      arrivalTime: arr.slice(0, 5),
      durationMinutes: this.timeDiff(dep.slice(0, 5), arr.slice(0, 5)),
      changes: Math.max(0, legs.length - 1),
      legs,
    };
  }

  private delayMinutes(scheduled: string, actual?: string): number | undefined {
    if (!actual || scheduled === actual) return undefined;
    const [sh, sm] = scheduled.split(':').map(Number);
    const [ah, am] = actual.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(ah) || isNaN(am)) return undefined;
    const diff = (ah * 60 + am) - (sh * 60 + sm);
    return diff > 0 ? diff : undefined;
  }

  private timeDiff(dep: string, arr: string): number {
    const [dh, dm] = dep.split(':').map(Number);
    const [ah, am] = arr.split(':').map(Number);
    if (isNaN(dh) || isNaN(dm) || isNaN(ah) || isNaN(am)) return 0;
    return (ah * 60 + am) - (dh * 60 + dm);
  }
}
