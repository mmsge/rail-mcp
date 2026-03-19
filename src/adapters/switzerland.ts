import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';

// OpenTransportData.swiss - OJP (Open Journey Planner) API
const BASE = 'https://api.opentransportdata.swiss/ojp2020';
// Also supports the simpler transport.opendata.ch API as fallback
const FALLBACK_BASE = 'https://transport.opendata.ch/v1';

interface OpenDataStation {
  id?: string;
  name?: string;
  coordinate?: { x?: number; y?: number };
  score?: number;
}

interface OpenDataStationResponse {
  stations?: OpenDataStation[];
}

interface OpenDataStopboard {
  number?: string;
  category?: string;
  categoryCode?: number;
  name?: string;
  to?: string;
  operator?: string;
  stop?: { station?: OpenDataStation; departure?: string; prognosis?: { departure?: string; platform?: string; capacity1st?: string } };
  platform?: string;
}

interface OpenDataStopboardResponse {
  stationboard?: OpenDataStopboard[];
}

interface OpenDataConnection {
  duration?: string;
  transfers?: number;
  from?: { station?: OpenDataStation; departure?: string; prognosis?: { departure?: string; platform?: string } };
  to?: { station?: OpenDataStation; arrival?: string; prognosis?: { arrival?: string } };
  sections?: Array<{
    journey?: { name?: string; category?: string; number?: string; operator?: string; passList?: OpenDataStopboard[] };
    walk?: { duration?: number };
    departure?: { station?: OpenDataStation; departure?: string; prognosis?: { departure?: string; platform?: string } };
    arrival?: { station?: OpenDataStation; arrival?: string };
  }>;
}

interface OpenDataConnectionResponse {
  connections?: OpenDataConnection[];
}

// Switzerland uses opendata.ch as a reliable free fallback API (transport.opendata.ch)
export class SwitzerlandAdapter extends RailAdapter {
  readonly country: Country = 'CH';
  readonly name = 'Swiss Federal Railways / opendata.ch';

  isAvailable(): boolean {
    return true; // Using transport.opendata.ch which is free and open
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${FALLBACK_BASE}/locations?query=${encodeURIComponent(query)}&type=station`;
    const data = await this.fetchJson<OpenDataStationResponse>(url);
    return (data.stations ?? [])
      .filter(s => s.id && s.name)
      .map(s => ({
        id: s.id!,
        name: s.name!,
        country: this.country,
        lat: s.coordinate?.y,
        lon: s.coordinate?.x,
      }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${FALLBACK_BASE}/stationboard?id=${encodeURIComponent(stationId)}&limit=${limit}&type=departure`;
    const data = await this.fetchJson<OpenDataStopboardResponse>(url);
    return (data.stationboard ?? []).map(d => this.mapBoard(d, 'departure'));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${FALLBACK_BASE}/stationboard?id=${encodeURIComponent(stationId)}&limit=${limit}&type=arrival`;
    const data = await this.fetchJson<OpenDataStopboardResponse>(url);
    return (data.stationboard ?? []).map(d => this.mapBoard(d, 'arrival'));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const date = datetime.toISOString().slice(0, 10);
    const time = datetime.toTimeString().slice(0, 5);
    const url = `${FALLBACK_BASE}/connections?from=${encodeURIComponent(originId)}&to=${encodeURIComponent(destId)}&date=${date}&time=${time}&limit=5`;
    const data = await this.fetchJson<OpenDataConnectionResponse>(url);
    return (data.connections ?? []).map(c => this.mapConnection(c));
  }

  private mapBoard(d: OpenDataStopboard, type: 'departure' | 'arrival'): TrainService {
    const scheduled = d.stop?.departure ?? 'Unknown';
    const actualRaw = d.stop?.prognosis?.departure;
    const actual = actualRaw ?? undefined;
    return {
      trainNumber: (`${d.category ?? ''} ${d.number ?? ''}`.trim() || d.name) ?? 'Unknown',
      operator: d.operator,
      origin: type === 'arrival' ? (d.to ?? 'Unknown') : (d.stop?.station?.name ?? 'Unknown'),
      destination: type === 'departure' ? (d.to ?? 'Unknown') : (d.stop?.station?.name ?? 'Unknown'),
      scheduledTime: this.formatISO(scheduled),
      actualTime: actual ? this.formatISO(actual) : undefined,
      delayMinutes: this.calcDelay(scheduled, actual),
      platform: d.stop?.prognosis?.platform ?? d.platform,
      isCancelled: false,
      country: this.country,
    };
  }

  private mapConnection(c: OpenDataConnection): Journey {
    const legs: JourneyLeg[] = (c.sections ?? [])
      .filter(s => s.journey)
      .map(s => ({
        origin: s.departure?.station?.name ?? 'Unknown',
        destination: s.arrival?.station?.name ?? 'Unknown',
        departureTime: this.formatISO(s.departure?.prognosis?.departure ?? s.departure?.departure ?? ''),
        arrivalTime: this.formatISO(s.arrival?.arrival ?? ''),
        trainNumber: `${s.journey?.category ?? ''} ${s.journey?.number ?? ''}`.trim() || 'Unknown',
        operator: s.journey?.operator,
        platform: s.departure?.prognosis?.platform,
      }));

    const depTime = c.from?.prognosis?.departure ?? c.from?.departure ?? '';
    const arrTime = c.to?.prognosis?.arrival ?? c.to?.arrival ?? '';

    return {
      departureTime: this.formatISO(depTime),
      arrivalTime: this.formatISO(arrTime),
      durationMinutes: this.parseDuration(c.duration ?? ''),
      changes: c.transfers ?? Math.max(0, legs.length - 1),
      legs,
    };
  }

  private formatISO(iso: string): string {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  }

  private calcDelay(scheduled: string, actual?: string): number | undefined {
    if (!actual || !scheduled) return undefined;
    const s = new Date(scheduled).getTime();
    const a = new Date(actual).getTime();
    if (isNaN(s) || isNaN(a)) return undefined;
    const diff = Math.round((a - s) / 60_000);
    return diff > 0 ? diff : undefined;
  }

  // Duration format: "00d00:30:00"
  private parseDuration(dur: string): number {
    const match = dur.match(/(\d+)d(\d+):(\d+):(\d+)/);
    if (!match) return 0;
    return parseInt(match[1]) * 1440 + parseInt(match[2]) * 60 + parseInt(match[3]);
  }
}
