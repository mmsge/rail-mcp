import type { Country, Journey, Station, TrainService } from './types.js';
import { COUNTRY_NAMES } from './types.js';
import { RailAdapter } from './adapters/base.js';
import { GermanyAdapter } from './adapters/germany.js';
import { UKAdapter } from './adapters/uk.js';
import { NorwayAdapter } from './adapters/norway.js';
import { SwedenAdapter } from './adapters/sweden.js';
import { DenmarkAdapter } from './adapters/denmark.js';
import { FranceAdapter } from './adapters/france.js';
import { SwitzerlandAdapter } from './adapters/switzerland.js';

export class AdapterRegistry {
  private adapters: Map<Country, RailAdapter> = new Map();

  constructor() {
    const all: RailAdapter[] = [
      new GermanyAdapter(),
      new UKAdapter(),
      new NorwayAdapter(),
      new SwedenAdapter(),
      new DenmarkAdapter(),
      new FranceAdapter(),
      new SwitzerlandAdapter(),
    ];
    for (const adapter of all) {
      this.adapters.set(adapter.country, adapter);
    }
  }

  getAdapter(country: Country): RailAdapter | undefined {
    return this.adapters.get(country);
  }

  availableAdapters(): RailAdapter[] {
    return [...this.adapters.values()].filter(a => a.isAvailable());
  }

  unavailableAdapters(): RailAdapter[] {
    return [...this.adapters.values()].filter(a => !a.isAvailable());
  }

  /** Search across all available adapters (or a specific country) */
  async searchStations(query: string, country?: string): Promise<Station[]> {
    const targetCountry = country?.toUpperCase() as Country | undefined;

    if (targetCountry) {
      const adapter = this.adapters.get(targetCountry);
      if (!adapter) throw new Error(`Unknown country code: ${country}. Use: ${[...this.adapters.keys()].join(', ')}`);
      if (!adapter.isAvailable()) {
        const vars = adapter.requiredEnvVars();
        throw new Error(`${COUNTRY_NAMES[targetCountry]} adapter requires environment variable(s): ${vars.join(', ')}`);
      }
      return adapter.searchStations(query);
    }

    // Search all available adapters in parallel
    const results = await Promise.allSettled(
      this.availableAdapters().map(a => a.searchStations(query))
    );

    const stations: Station[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        stations.push(...result.value);
      }
    }
    return stations;
  }

  async getDepartures(stationId: string, country: string, limit: number): Promise<TrainService[]> {
    const adapter = this.requireAdapter(country);
    return adapter.getDepartures(stationId, limit);
  }

  async getArrivals(stationId: string, country: string, limit: number): Promise<TrainService[]> {
    const adapter = this.requireAdapter(country);
    return adapter.getArrivals(stationId, limit);
  }

  async getJourney(originId: string, destId: string, country: string, datetime: Date): Promise<Journey[]> {
    const adapter = this.requireAdapter(country);
    return adapter.getJourney(originId, destId, datetime);
  }

  private requireAdapter(country: string): RailAdapter {
    const code = country.toUpperCase() as Country;
    const adapter = this.adapters.get(code);
    if (!adapter) {
      throw new Error(`Unknown country code: ${country}. Supported: ${[...this.adapters.keys()].join(', ')}`);
    }
    if (!adapter.isAvailable()) {
      const vars = adapter.requiredEnvVars();
      throw new Error(
        `${COUNTRY_NAMES[code]} adapter requires environment variable(s): ${vars.join(', ')}. ` +
        `See .env.example for setup instructions.`
      );
    }
    return adapter;
  }

  statusReport(): string {
    const lines: string[] = ['Rail MCP - Adapter Status:'];
    for (const [code, adapter] of this.adapters) {
      const status = adapter.isAvailable() ? '✓ Available' : `✗ Needs: ${adapter.requiredEnvVars().join(', ')}`;
      lines.push(`  ${COUNTRY_NAMES[code]} (${code}): ${status}`);
    }
    return lines.join('\n');
  }
}
