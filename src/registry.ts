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
  async searchStations(query: string, country?: string): Promise<{ stations: Station[]; notes: string[] }> {
    const notes: string[] = [];
    const targetCountry = country?.toUpperCase() as Country | undefined;

    if (targetCountry) {
      const adapter = this.adapters.get(targetCountry);
      if (!adapter) throw new Error(`Unknown country code: ${country}. Use: ${[...this.adapters.keys()].join(', ')}`);
      if (!adapter.isAvailable()) {
        const vars = adapter.requiredEnvVars();
        throw new Error(
          `${COUNTRY_NAMES[targetCountry]} requires environment variable(s): ${vars.join(', ')}. ` +
          `Run get_status to see all available countries.`
        );
      }
      return { stations: await adapter.searchStations(query), notes };
    }

    // Note any unavailable adapters before searching
    const unavailable = this.unavailableAdapters();
    if (unavailable.length > 0) {
      const names = unavailable.map(a => `${COUNTRY_NAMES[a.country]} (needs ${a.requiredEnvVars().join(', ')})`);
      notes.push(`Skipped countries with missing API keys: ${names.join('; ')}. Run get_status for details.`);
    }

    // Search all available adapters in parallel
    const available = this.availableAdapters();
    if (available.length === 0) {
      throw new Error('No rail adapters are available. Run get_status to see configuration requirements.');
    }

    const results = await Promise.allSettled(available.map(a => a.searchStations(query)));

    const stations: Station[] = [];
    const errors: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        stations.push(...result.value);
      } else {
        errors.push(`${COUNTRY_NAMES[available[i].country]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
    if (errors.length > 0) {
      notes.push(`Some countries returned errors: ${errors.join('; ')}`);
    }
    return { stations, notes };
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
    const available: string[] = [];
    const unavailable: string[] = [];

    for (const [code, adapter] of this.adapters) {
      if (adapter.isAvailable()) {
        const noKey = adapter.requiredEnvVars().length === 0 ? ' (no API key required)' : ' (API key configured)';
        available.push(`  ${COUNTRY_NAMES[code]} (${code})${noKey}`);
      } else {
        const vars = adapter.requiredEnvVars();
        unavailable.push(`  ${COUNTRY_NAMES[code]} (${code}): set ${vars.join(', ')} to enable`);
      }
    }

    const lines: string[] = ['Rail MCP - Adapter Status:'];
    lines.push(`\nAvailable (${available.length}):`);
    lines.push(...available);
    if (unavailable.length > 0) {
      lines.push(`\nUnavailable - missing API keys (${unavailable.length}):`);
      lines.push(...unavailable);
      lines.push('\nSee .env.example for how to obtain free API keys.');
    }
    return lines.join('\n');
  }
}
