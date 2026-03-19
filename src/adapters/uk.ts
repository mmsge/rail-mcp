import { RailAdapter } from './base.js';
import type { Country, Journey, Station, TrainService } from '../types.js';

const BASE = 'https://huxley2.azurewebsites.net';

interface HuxleyService {
  std?: string;   // Scheduled time of departure
  etd?: string;   // Estimated time of departure
  sta?: string;   // Scheduled time of arrival
  eta?: string;   // Estimated time of arrival
  platform?: string;
  isCancelled?: boolean;
  operatorCode?: string;
  operator?: string;
  origin?: Array<{ locationName: string }>;
  destination?: Array<{ locationName: string }>;
  trainid?: string;
  serviceID?: string;
}

interface HuxleyBoard {
  locationName?: string;
  crs?: string;
  trainServices?: HuxleyService[];
}

interface HuxleyCrs {
  stationName?: string;
  crsCode?: string;
}

export class UKAdapter extends RailAdapter {
  readonly country: Country = 'GB';
  readonly name = 'National Rail (Huxley2)';

  isAvailable(): boolean {
    return true; // Huxley2 requires no API key
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${BASE}/crs/${encodeURIComponent(query)}`;
    const results = await this.fetchJson<HuxleyCrs[]>(url);
    return (Array.isArray(results) ? results : [results]).map(r => ({
      id: r.crsCode ?? '',
      name: r.stationName ?? r.crsCode ?? '',
      country: this.country,
    })).filter(s => s.id);
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/departures/${encodeURIComponent(stationId)}/${limit}?expand=true`;
    const data = await this.fetchJson<HuxleyBoard>(url);
    return (data.trainServices ?? []).map(s => this.mapDeparture(s, data.locationName ?? stationId));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/arrivals/${encodeURIComponent(stationId)}/${limit}?expand=true`;
    const data = await this.fetchJson<HuxleyBoard>(url);
    return (data.trainServices ?? []).map(s => this.mapArrival(s, data.locationName ?? stationId));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    // Huxley2 supports filtering departures by destination
    const url = `${BASE}/departures/${encodeURIComponent(originId)}/5/${encodeURIComponent(destId)}?expand=true`;
    const data = await this.fetchJson<HuxleyBoard>(url);
    return (data.trainServices ?? []).map(s => ({
      departureTime: s.std ?? s.etd ?? 'Unknown',
      arrivalTime: 'See board',
      durationMinutes: 0,
      changes: 0,
      legs: [{
        origin: data.locationName ?? originId,
        destination: s.destination?.[0]?.locationName ?? destId,
        departureTime: s.std ?? 'Unknown',
        arrivalTime: s.eta ?? s.sta ?? 'Unknown',
        trainNumber: s.trainid ?? s.serviceID ?? 'Unknown',
        operator: s.operator,
        platform: s.platform,
      }],
    }));
  }

  private mapDeparture(s: HuxleyService, stationName: string): TrainService {
    const scheduled = s.std ?? '';
    const actual = s.etd;
    const delay = this.calcDelay(scheduled, actual);
    return {
      trainNumber: s.trainid ?? s.serviceID ?? 'Unknown',
      operator: s.operator,
      origin: stationName,
      destination: s.destination?.[0]?.locationName ?? 'Unknown',
      scheduledTime: scheduled || 'Unknown',
      actualTime: actual && actual !== 'On time' && actual !== 'Cancelled' ? actual : undefined,
      delayMinutes: delay,
      platform: s.platform,
      isCancelled: s.isCancelled ?? actual === 'Cancelled',
      country: this.country,
    };
  }

  private mapArrival(s: HuxleyService, stationName: string): TrainService {
    const scheduled = s.sta ?? '';
    const actual = s.eta;
    const delay = this.calcDelay(scheduled, actual);
    return {
      trainNumber: s.trainid ?? s.serviceID ?? 'Unknown',
      operator: s.operator,
      origin: s.origin?.[0]?.locationName ?? 'Unknown',
      destination: stationName,
      scheduledTime: scheduled || 'Unknown',
      actualTime: actual && actual !== 'On time' && actual !== 'Cancelled' ? actual : undefined,
      delayMinutes: delay,
      platform: s.platform,
      isCancelled: s.isCancelled ?? actual === 'Cancelled',
      country: this.country,
    };
  }

  private calcDelay(scheduled: string, actual?: string): number | undefined {
    if (!actual || actual === 'On time' || actual === 'Cancelled') return undefined;
    // Times are in HH:MM format
    const [sh, sm] = scheduled.split(':').map(Number);
    const [ah, am] = actual.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(ah) || isNaN(am)) return undefined;
    return (ah * 60 + am) - (sh * 60 + sm);
  }
}
