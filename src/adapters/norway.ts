import { RailAdapter } from './base.js';
import type { Country, Journey, JourneyLeg, Station, TrainService } from '../types.js';

const GEOCODER = 'https://api.entur.io/geocoder/v1';
const JOURNEY = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT = 'rail-mcp-european-trains';

interface EnturFeature {
  properties: {
    id: string;
    name: string;
    label?: string;
    category?: string[];
    locality?: string;
    county?: string;
  };
  geometry: { coordinates: [number, number] };
}

interface EnturGeocoderResponse {
  features: EnturFeature[];
}

interface EnturStopCall {
  expectedDepartureTime?: string;
  aimedDepartureTime?: string;
  expectedArrivalTime?: string;
  aimedArrivalTime?: string;
  cancellation?: boolean;
  quay?: { name?: string; publicCode?: string };
  destinationDisplay?: { frontText?: string };
  serviceJourney?: {
    line?: { publicCode?: string; operator?: { name?: string } };
    journeyPattern?: { directionType?: string };
  };
}

interface EnturEstimatedCall extends EnturStopCall {
  realtime?: boolean;
}

interface EnturTripPattern {
  duration?: number;
  legs?: Array<{
    fromPlace?: { name: string };
    toPlace?: { name: string };
    expectedStartTime?: string;
    expectedEndTime?: string;
    line?: { publicCode?: string; operator?: { name?: string } };
    fromEstimatedCall?: { quay?: { publicCode?: string } };
    mode?: string;
  }>;
}

export class NorwayAdapter extends RailAdapter {
  readonly country: Country = 'NO';
  readonly name = 'Entur (Norway)';

  isAvailable(): boolean {
    return true; // Only needs ET-Client-Name header, no API key
  }

  private get headers() {
    return {
      'ET-Client-Name': CLIENT,
      'Content-Type': 'application/json',
    };
  }

  async searchStations(query: string): Promise<Station[]> {
    const url = `${GEOCODER}/autocomplete?text=${encodeURIComponent(query)}&size=10&lang=en&layers=venue`;
    const data = await this.fetchJson<EnturGeocoderResponse>(url, { headers: { 'ET-Client-Name': CLIENT } });
    return (data.features ?? [])
      .filter(f => f.properties.category?.some(c => c.includes('rail') || c.includes('bus') || c.includes('stop')))
      .map(f => ({
        id: f.properties.id,
        name: f.properties.name,
        country: this.country,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      }));
  }

  async getDepartures(stationId: string, limit: number): Promise<TrainService[]> {
    const query = `{
      stopPlace(id: "${stationId}") {
        name
        estimatedCalls(numberOfDepartures: ${limit}, omitNonBoarding: true) {
          realtime
          aimedDepartureTime
          expectedDepartureTime
          cancellation
          quay { publicCode }
          destinationDisplay { frontText }
          serviceJourney {
            line { publicCode operator { name } }
          }
        }
      }
    }`;

    const data = await this.fetchJson<{ data?: { stopPlace?: { name?: string; estimatedCalls?: EnturEstimatedCall[] } } }>(
      JOURNEY,
      { method: 'POST', headers: this.headers, body: JSON.stringify({ query }) }
    );

    const stopPlace = data.data?.stopPlace;
    const stationName = stopPlace?.name ?? stationId;
    return (stopPlace?.estimatedCalls ?? []).map(c => this.mapCall(c, stationName, 'departure'));
  }

  async getArrivals(stationId: string, limit: number): Promise<TrainService[]> {
    const query = `{
      stopPlace(id: "${stationId}") {
        name
        estimatedCalls(numberOfDepartures: ${limit}, omitNonBoarding: true, arrivalDeparture: arrivals) {
          realtime
          aimedArrivalTime
          expectedArrivalTime
          cancellation
          quay { publicCode }
          serviceJourney {
            line { publicCode operator { name } }
            journeyPattern { directionType }
          }
        }
      }
    }`;

    const data = await this.fetchJson<{ data?: { stopPlace?: { name?: string; estimatedCalls?: EnturEstimatedCall[] } } }>(
      JOURNEY,
      { method: 'POST', headers: this.headers, body: JSON.stringify({ query }) }
    );

    const stopPlace = data.data?.stopPlace;
    const stationName = stopPlace?.name ?? stationId;
    return (stopPlace?.estimatedCalls ?? []).map(c => this.mapCall(c, stationName, 'arrival'));
  }

  async getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]> {
    const query = `{
      trip(
        from: { place: "${originId}" }
        to: { place: "${destId}" }
        dateTime: "${datetime.toISOString()}"
        numTripPatterns: 5
        modes: { transportModes: [{ transportMode: rail }] }
      ) {
        tripPatterns {
          duration
          legs {
            fromPlace { name }
            toPlace { name }
            expectedStartTime
            expectedEndTime
            line { publicCode operator { name } }
            fromEstimatedCall { quay { publicCode } }
            mode
          }
        }
      }
    }`;

    const data = await this.fetchJson<{ data?: { trip?: { tripPatterns?: EnturTripPattern[] } } }>(
      JOURNEY,
      { method: 'POST', headers: this.headers, body: JSON.stringify({ query }) }
    );

    return (data.data?.trip?.tripPatterns ?? []).map(p => this.mapJourney(p));
  }

  private mapCall(c: EnturEstimatedCall, stationName: string, type: 'departure' | 'arrival'): TrainService {
    const aimed = type === 'departure' ? c.aimedDepartureTime : c.aimedArrivalTime;
    const expected = type === 'departure' ? c.expectedDepartureTime : c.expectedArrivalTime;
    const delay = aimed && expected ? Math.round((new Date(expected).getTime() - new Date(aimed).getTime()) / 60_000) : undefined;

    return {
      trainNumber: c.serviceJourney?.line?.publicCode ?? 'Unknown',
      operator: c.serviceJourney?.line?.operator?.name,
      origin: type === 'arrival' ? 'Unknown' : stationName,
      destination: type === 'departure' ? (c.destinationDisplay?.frontText ?? 'Unknown') : stationName,
      scheduledTime: this.formatTime(aimed ?? ''),
      actualTime: expected && expected !== aimed ? this.formatTime(expected) : undefined,
      delayMinutes: delay && delay > 0 ? delay : undefined,
      platform: c.quay?.publicCode,
      isCancelled: c.cancellation ?? false,
      country: this.country,
    };
  }

  private mapJourney(p: EnturTripPattern): Journey {
    const legs: JourneyLeg[] = (p.legs ?? []).map(leg => ({
      origin: leg.fromPlace?.name ?? 'Unknown',
      destination: leg.toPlace?.name ?? 'Unknown',
      departureTime: this.formatTime(leg.expectedStartTime ?? ''),
      arrivalTime: this.formatTime(leg.expectedEndTime ?? ''),
      trainNumber: leg.line?.publicCode ?? leg.mode ?? 'Unknown',
      operator: leg.line?.operator?.name,
      platform: leg.fromEstimatedCall?.quay?.publicCode,
    }));

    const first = p.legs?.[0];
    const last = p.legs?.[p.legs.length - 1];

    return {
      departureTime: this.formatTime(first?.expectedStartTime ?? ''),
      arrivalTime: this.formatTime(last?.expectedEndTime ?? ''),
      durationMinutes: p.duration ? Math.round(p.duration / 60) : 0,
      changes: Math.max(0, legs.length - 1),
      legs,
    };
  }

  private formatTime(iso: string): string {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });
  }
}
