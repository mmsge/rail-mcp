import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';

const BASE = 'https://api.resrobot.se/v2.1';

interface ResRobotStop {
  id: string;
  extId?: string;
  name: string;
  lon?: number;
  lat?: number;
}

interface ResRobotStopResponse {
  stopLocationOrCoordLocation?: Array<{ StopLocation?: ResRobotStop }>;
}

interface ResRobotDeparture {
  name?: string;
  trainNumber?: string;
  transportNumber?: string;
  operator?: string;
  stop?: string;
  direction?: string;
  origin?: string;
  date?: string;
  time?: string;
  rtDate?: string;
  rtTime?: string;
  cancelled?: boolean;
  platform?: string;
  rtPlatform?: string;
  Product?: Array<{ catOut?: string; catOutL?: string; operator?: string; operatorUrl?: string }>;
}

interface ResRobotDepartureBoard {
  Departure?: ResRobotDeparture[];
}

interface ResRobotTrip {
  LegList?: { Leg?: ResRobotLeg[] };
}

interface ResRobotLeg {
  Origin?: { name: string; time?: string; rtTime?: string };
  Destination?: { name: string; time?: string; rtTime?: string };
  name?: string;
  transportNumber?: string;
  operator?: string;
  platform?: string;
}

interface ResRobotTripResponse {
  Trip?: ResRobotTrip[];
}

export class SwedenAdapter extends RailAdapter {
  readonly country: Country = 'SE';
  readonly name = 'Trafiklab ResRobot (Sweden)';

  isAvailable(): boolean {
    return !!process.env.TRAFIKLAB_API_KEY;
  }

  requiredEnvVars(): string[] {
    return ['TRAFIKLAB_API_KEY'];
  }

  private get key(): string {
    return process.env.TRAFIKLAB_API_KEY ?? '';
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${BASE}/location.name?input=${encodeURIComponent(query)}&format=json&accessId=${this.key}&maxNo=10&type=S`;
    const data = await this.fetchJson<ResRobotStopResponse>(url);
    return (data.stopLocationOrCoordLocation ?? [])
      .map(e => e.StopLocation)
      .filter((s): s is ResRobotStop => !!s)
      .map(s => ({
        id: s.extId ?? s.id,
        name: s.name,
        country: this.country,
        lat: s.lat,
        lon: s.lon,
      }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/departureBoard?id=${encodeURIComponent(stationId)}&format=json&accessId=${this.key}&maxJourneys=${limit}`;
    const data = await this.fetchJson<ResRobotDepartureBoard>(url);
    return (data.Departure ?? []).map(d => this.mapDeparture(d));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/arrivalBoard?id=${encodeURIComponent(stationId)}&format=json&accessId=${this.key}&maxJourneys=${limit}`;
    const data = await this.fetchJson<ResRobotDepartureBoard>(url);
    return (data.Departure ?? []).map(d => this.mapArrival(d));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const date = datetime.toISOString().slice(0, 10);
    const time = datetime.toTimeString().slice(0, 5);
    const url = `${BASE}/trip?originId=${encodeURIComponent(originId)}&destId=${encodeURIComponent(destId)}&date=${date}&time=${time}&format=json&accessId=${this.key}&numF=5`;
    const data = await this.fetchJson<ResRobotTripResponse>(url);
    return (data.Trip ?? []).map(t => this.mapTrip(t));
  }

  private mapDeparture(d: ResRobotDeparture): TrainService {
    const scheduled = this.toTime(d.date, d.time);
    const actual = d.rtTime ? this.toTime(d.rtDate ?? d.date, d.rtTime) : undefined;
    return {
      trainNumber: d.transportNumber ?? d.name ?? 'Unknown',
      operator: d.Product?.[0]?.operator ?? d.operator,
      origin: d.stop ?? 'Unknown',
      destination: d.direction ?? d.origin ?? 'Unknown',
      scheduledTime: scheduled,
      actualTime: actual !== scheduled ? actual : undefined,
      delayMinutes: this.delayMinutes(scheduled, actual),
      platform: d.rtPlatform ?? d.platform,
      isCancelled: d.cancelled ?? false,
      country: this.country,
    };
  }

  private mapArrival(d: ResRobotDeparture): TrainService {
    const scheduled = this.toTime(d.date, d.time);
    const actual = d.rtTime ? this.toTime(d.rtDate ?? d.date, d.rtTime) : undefined;
    return {
      trainNumber: d.transportNumber ?? d.name ?? 'Unknown',
      operator: d.Product?.[0]?.operator ?? d.operator,
      origin: d.direction ?? d.origin ?? 'Unknown',
      destination: d.stop ?? 'Unknown',
      scheduledTime: scheduled,
      actualTime: actual !== scheduled ? actual : undefined,
      delayMinutes: this.delayMinutes(scheduled, actual),
      platform: d.rtPlatform ?? d.platform,
      isCancelled: d.cancelled ?? false,
      country: this.country,
    };
  }

  private mapTrip(t: ResRobotTrip): Journey {
    const legs: JourneyLeg[] = (t.LegList?.Leg ?? []).map(l => ({
      origin: l.Origin?.name ?? 'Unknown',
      destination: l.Destination?.name ?? 'Unknown',
      departureTime: l.Origin?.rtTime ?? l.Origin?.time ?? 'Unknown',
      arrivalTime: l.Destination?.rtTime ?? l.Destination?.time ?? 'Unknown',
      trainNumber: l.transportNumber ?? l.name ?? 'Unknown',
      operator: l.operator,
      platform: l.platform,
    }));

    const first = t.LegList?.Leg?.[0];
    const last = t.LegList?.Leg?.[t.LegList.Leg.length - 1];
    const dep = first?.Origin?.rtTime ?? first?.Origin?.time ?? '';
    const arr = last?.Destination?.rtTime ?? last?.Destination?.time ?? '';

    return {
      departureTime: dep,
      arrivalTime: arr,
      durationMinutes: this.timeDiff(dep, arr),
      changes: Math.max(0, legs.length - 1),
      legs,
    };
  }

  private toTime(date?: string, time?: string): string {
    if (!time) return 'Unknown';
    return time.slice(0, 5);
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
