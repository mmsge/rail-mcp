import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';

const BASE = 'https://v6.db.transport.rest';

interface DBStop {
  id: string;
  name: string;
  location?: { latitude: number; longitude: number };
  type?: string;
}

interface DBDeparture {
  tripId: string;
  stop?: DBStop;
  when?: string;
  plannedWhen?: string;
  delay?: number;
  platform?: string;
  plannedPlatform?: string;
  cancelled?: boolean;
  line?: { name: string; operator?: { name: string } };
  direction?: string;
  origin?: { name: string };
  destination?: { name: string };
}

interface DBJourneyLeg {
  origin?: DBStop;
  destination?: DBStop;
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  line?: { name: string; operator?: { name: string } };
  departurePlatform?: string;
}

interface DBJourney {
  legs?: DBJourneyLeg[];
}

export class GermanyAdapter extends RailAdapter {
  readonly country: Country = 'DE';
  readonly name = 'Deutsche Bahn (db.transport.rest)';

  isAvailable(): boolean {
    return true; // no API key required
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${BASE}/locations?query=${encodeURIComponent(query)}&results=10&stops=true&addresses=false&poi=false`;
    const stops = await this.fetchJson<DBStop[]>(url);
    return stops
      .filter(s => s.type === 'stop' || s.type === 'station')
      .map(s => ({
        id: s.id,
        name: s.name,
        country: this.country,
        lat: s.location?.latitude,
        lon: s.location?.longitude,
      }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/stops/${encodeURIComponent(stationId)}/departures?results=${limit}&duration=120`;
    const data = await this.fetchJson<{ departures?: DBDeparture[] }>(url);
    return (data.departures ?? []).map(d => this.mapService(d, 'departure'));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const url = `${BASE}/stops/${encodeURIComponent(stationId)}/arrivals?results=${limit}&duration=120`;
    const data = await this.fetchJson<{ arrivals?: DBDeparture[] }>(url);
    return (data.arrivals ?? []).map(d => this.mapService(d, 'arrival'));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const url = `${BASE}/journeys?from=${encodeURIComponent(originId)}&to=${encodeURIComponent(destId)}&departure=${datetime.toISOString()}&results=5`;
    const data = await this.fetchJson<{ journeys?: DBJourney[] }>(url);
    return (data.journeys ?? []).map(j => this.mapJourney(j));
  }

  private mapService(d: DBDeparture, type: 'departure' | 'arrival'): TrainService {
    const scheduled = d.plannedWhen ?? d.when ?? '';
    const actual = d.when ?? undefined;
    const delayMs = d.delay ?? 0;
    return {
      trainNumber: d.line?.name ?? d.tripId ?? 'Unknown',
      operator: d.line?.operator?.name,
      origin: type === 'arrival' ? (d.origin?.name ?? 'Unknown') : (d.stop?.name ?? 'Unknown'),
      destination: type === 'departure' ? (d.direction ?? d.destination?.name ?? 'Unknown') : (d.stop?.name ?? 'Unknown'),
      scheduledTime: this.formatTime(scheduled),
      actualTime: actual ? this.formatTime(actual) : undefined,
      delayMinutes: delayMs ? Math.round(delayMs / 60) : undefined,
      platform: d.platform ?? d.plannedPlatform,
      isCancelled: d.cancelled ?? false,
      country: this.country,
    };
  }

  private mapJourney(j: DBJourney): Journey {
    const legs: JourneyLeg[] = (j.legs ?? []).map(leg => ({
      origin: leg.origin?.name ?? 'Unknown',
      destination: leg.destination?.name ?? 'Unknown',
      departureTime: this.formatTime(leg.departure ?? leg.plannedDeparture ?? ''),
      arrivalTime: this.formatTime(leg.arrival ?? leg.plannedArrival ?? ''),
      trainNumber: leg.line?.name ?? 'Unknown',
      operator: leg.line?.operator?.name,
      platform: leg.departurePlatform,
    }));

    const first = j.legs?.[0];
    const last = j.legs?.[j.legs.length - 1];
    const depTime = first?.departure ?? first?.plannedDeparture ?? '';
    const arrTime = last?.arrival ?? last?.plannedArrival ?? '';
    const depMs = new Date(depTime).getTime();
    const arrMs = new Date(arrTime).getTime();

    return {
      departureTime: this.formatTime(depTime),
      arrivalTime: this.formatTime(arrTime),
      durationMinutes: isNaN(depMs) || isNaN(arrMs) ? 0 : Math.round((arrMs - depMs) / 60_000),
      changes: Math.max(0, legs.length - 1),
      legs,
    };
  }

  private formatTime(iso: string): string {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  }
}
