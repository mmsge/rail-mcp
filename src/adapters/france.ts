import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';

const BASE = 'https://api.sncf.com/v1/coverage/sncf';

interface SNCFStop {
  stop_area?: {
    id: string;
    name: string;
    coord?: { lat: string; lon: string };
  };
}

interface SNCFStopAreaResponse {
  stop_areas?: Array<{ id: string; name: string; coord?: { lat: string; lon: string } }>;
}

interface SNCFDeparture {
  display_informations?: {
    headsign?: string;
    label?: string;
    name?: string;
    commercial_mode?: string;
    network?: string;
    direction?: string;
  };
  stop_date_time?: {
    departure_date_time?: string;
    base_departure_date_time?: string;
    arrival_date_time?: string;
    base_arrival_date_time?: string;
  };
  stop_point?: {
    stop_area?: { name?: string };
    platform_code?: string;
    name?: string;
  };
  disruptions?: Array<{ severity?: { effect?: string } }>;
}

interface SNCFDepartureResponse {
  departures?: SNCFDeparture[];
}

interface SNCFArrivalResponse {
  arrivals?: SNCFDeparture[];
}

interface SNCFJourneySection {
  from?: { name?: string };
  to?: { name?: string };
  departure_date_time?: string;
  arrival_date_time?: string;
  display_informations?: { label?: string; name?: string; commercial_mode?: string };
  stop_date_times?: Array<{ stop_point?: { platform_code?: string } }>;
  type?: string;
}

interface SNCFJourney {
  departure_date_time?: string;
  arrival_date_time?: string;
  duration?: number;
  nb_transfers?: number;
  sections?: SNCFJourneySection[];
}

interface SNCFJourneyResponse {
  journeys?: SNCFJourney[];
}

export class FranceAdapter extends RailAdapter {
  readonly country: Country = 'FR';
  readonly name = 'SNCF API (France)';

  isAvailable(): boolean {
    return !!process.env.SNCF_API_KEY;
  }

  requiredEnvVars(): string[] {
    return ['SNCF_API_KEY'];
  }

  private get authHeader() {
    const key = process.env.SNCF_API_KEY ?? '';
    return { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${BASE}/stop_areas?q=${encodeURIComponent(query)}&count=10&type[]=stop_area`;
    const data = await this.fetchJson<SNCFStopAreaResponse>(url, { headers: this.authHeader });
    return (data.stop_areas ?? []).map(s => ({
      id: s.id,
      name: s.name,
      country: this.country,
      lat: s.coord?.lat ? parseFloat(s.coord.lat) : undefined,
      lon: s.coord?.lon ? parseFloat(s.coord.lon) : undefined,
    }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/stop_areas/${encodeURIComponent(stationId)}/departures?count=${limit}&data_freshness=realtime`;
    const data = await this.fetchJson<SNCFDepartureResponse>(url, { headers: this.authHeader });
    return (data.departures ?? []).map(d => this.mapDeparture(d));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/stop_areas/${encodeURIComponent(stationId)}/arrivals?count=${limit}&data_freshness=realtime`;
    const data = await this.fetchJson<SNCFArrivalResponse>(url, { headers: this.authHeader });
    return (data.arrivals ?? []).map(d => this.mapArrival(d));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const dt = datetime.toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const url = `${BASE}/journeys?from=${encodeURIComponent(originId)}&to=${encodeURIComponent(destId)}&datetime=${dt}&count=5&data_freshness=realtime`;
    const data = await this.fetchJson<SNCFJourneyResponse>(url, { headers: this.authHeader });
    return (data.journeys ?? []).map(j => this.mapJourney(j));
  }

  private mapDeparture(d: SNCFDeparture): TrainService {
    const scheduled = d.stop_date_time?.base_departure_date_time ?? d.stop_date_time?.departure_date_time ?? '';
    const actual = d.stop_date_time?.departure_date_time ?? '';
    const isCancelled = d.disruptions?.some(dis => dis.severity?.effect === 'NO_SERVICE') ?? false;
    return {
      trainNumber: d.display_informations?.label ?? d.display_informations?.headsign ?? 'Unknown',
      operator: d.display_informations?.network,
      origin: d.stop_point?.stop_area?.name ?? d.stop_point?.name ?? 'Unknown',
      destination: d.display_informations?.direction ?? 'Unknown',
      scheduledTime: this.formatSNCFTime(scheduled),
      actualTime: actual && actual !== scheduled ? this.formatSNCFTime(actual) : undefined,
      delayMinutes: this.calcDelay(scheduled, actual),
      platform: d.stop_point?.platform_code,
      isCancelled,
      country: this.country,
    };
  }

  private mapArrival(d: SNCFDeparture): TrainService {
    const scheduled = d.stop_date_time?.base_arrival_date_time ?? d.stop_date_time?.arrival_date_time ?? '';
    const actual = d.stop_date_time?.arrival_date_time ?? '';
    const isCancelled = d.disruptions?.some(dis => dis.severity?.effect === 'NO_SERVICE') ?? false;
    return {
      trainNumber: d.display_informations?.label ?? d.display_informations?.headsign ?? 'Unknown',
      operator: d.display_informations?.network,
      origin: d.display_informations?.direction ?? 'Unknown',
      destination: d.stop_point?.stop_area?.name ?? d.stop_point?.name ?? 'Unknown',
      scheduledTime: this.formatSNCFTime(scheduled),
      actualTime: actual && actual !== scheduled ? this.formatSNCFTime(actual) : undefined,
      delayMinutes: this.calcDelay(scheduled, actual),
      platform: d.stop_point?.platform_code,
      isCancelled,
      country: this.country,
    };
  }

  private mapJourney(j: SNCFJourney): Journey {
    const legs: JourneyLeg[] = (j.sections ?? [])
      .filter(s => s.type === 'public_transport')
      .map(s => ({
        origin: s.from?.name ?? 'Unknown',
        destination: s.to?.name ?? 'Unknown',
        departureTime: this.formatSNCFTime(s.departure_date_time ?? ''),
        arrivalTime: this.formatSNCFTime(s.arrival_date_time ?? ''),
        trainNumber: s.display_informations?.label ?? 'Unknown',
        operator: s.display_informations?.commercial_mode,
        platform: s.stop_date_times?.[0]?.stop_point?.platform_code,
      }));

    return {
      departureTime: this.formatSNCFTime(j.departure_date_time ?? ''),
      arrivalTime: this.formatSNCFTime(j.arrival_date_time ?? ''),
      durationMinutes: j.duration ? Math.round(j.duration / 60) : 0,
      changes: j.nb_transfers ?? Math.max(0, legs.length - 1),
      legs,
    };
  }

  // SNCF times are in format: YYYYMMDDTHHmmss
  private formatSNCFTime(sncfTime: string): string {
    if (!sncfTime || sncfTime.length < 15) return sncfTime || 'Unknown';
    const h = sncfTime.slice(9, 11);
    const m = sncfTime.slice(11, 13);
    return `${h}:${m}`;
  }

  private calcDelay(scheduled: string, actual: string): number | undefined {
    if (!scheduled || !actual || scheduled === actual) return undefined;
    const toMin = (t: string) => {
      const h = parseInt(t.slice(9, 11));
      const m = parseInt(t.slice(11, 13));
      return h * 60 + m;
    };
    const diff = toMin(actual) - toMin(scheduled);
    return diff > 0 ? diff : undefined;
  }
}
