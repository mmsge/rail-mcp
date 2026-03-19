export type Country = 'NO' | 'SE' | 'DK' | 'DE' | 'FR' | 'GB' | 'CH';

export const COUNTRY_NAMES: Record<Country, string> = {
  NO: 'Norway',
  SE: 'Sweden',
  DK: 'Denmark',
  DE: 'Germany',
  FR: 'France',
  GB: 'United Kingdom',
  CH: 'Switzerland',
};

export interface Station {
  id: string;
  name: string;
  country: Country;
  lat?: number;
  lon?: number;
}

export interface TrainService {
  trainNumber: string;
  operator?: string;
  origin: string;
  destination: string;
  scheduledTime: string;  // ISO 8601 or HH:MM
  actualTime?: string;    // ISO 8601 or HH:MM, if real-time available
  delayMinutes?: number;
  platform?: string;
  isCancelled: boolean;
  country: Country;
}

export interface JourneyLeg {
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  trainNumber: string;
  operator?: string;
  platform?: string;
}

export interface Journey {
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  changes: number;
  legs: JourneyLeg[];
}
