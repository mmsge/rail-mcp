import type { Country, Journey, Station, TrainService } from '../types.js';

export abstract class RailAdapter {
  abstract readonly country: Country;
  abstract readonly name: string;

  /** Returns false if required API keys are missing */
  abstract isAvailable(): boolean;

  /** Returns the env var name(s) needed if not available */
  requiredEnvVars(): string[] {
    return [];
  }

  abstract searchStations(query: string): Promise<Station[]>;
  abstract getDepartures(stationId: string, limit: number): Promise<TrainService[]>;
  abstract getArrivals(stationId: string, limit: number): Promise<TrainService[]>;
  abstract getJourney(originId: string, destId: string, datetime: Date): Promise<Journey[]>;

  protected async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async fetchText(url: string, options?: RequestInit): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return res.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}
