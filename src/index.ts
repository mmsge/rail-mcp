#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AdapterRegistry } from './registry.js';
import type { Journey, Station, TrainService } from './types.js';
import { COUNTRY_NAMES } from './types.js';

const registry = new AdapterRegistry();
const server = new McpServer({
  name: 'rail-mcp',
  version: '1.0.0',
});

// ─── Tool: search_stations ────────────────────────────────────────────────────
server.tool(
  'search_stations',
  'Search for train stations by name across Europe. Optionally filter by country code (NO, SE, DK, DE, FR, GB, CH).',
  {
    query: z.string().describe('Station name to search for'),
    country: z.string().optional().describe('Country code to search in: NO (Norway), SE (Sweden), DK (Denmark), DE (Germany), FR (France), GB (United Kingdom), CH (Switzerland). Omit to search all available countries.'),
  },
  async ({ query, country }) => {
    try {
      const stations = await registry.searchStations(query, country);
      if (stations.length === 0) {
        return { content: [{ type: 'text', text: `No stations found for "${query}"${country ? ` in ${country}` : ''}.` }] };
      }
      const text = formatStations(stations);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${String(err instanceof Error ? err.message : err)}` }] };
    }
  }
);

// ─── Tool: get_departures ─────────────────────────────────────────────────────
server.tool(
  'get_departures',
  'Get live train departures from a station. Use search_stations to find the station ID first.',
  {
    station_id: z.string().describe('Station ID from search_stations'),
    country: z.string().describe('Country code: NO, SE, DK, DE, FR, GB, or CH'),
    limit: z.number().optional().describe('Max number of departures to return (default: 10)'),
  },
  async ({ station_id, country, limit = 10 }) => {
    try {
      const services = await registry.getDepartures(station_id, country, limit);
      if (services.length === 0) {
        return { content: [{ type: 'text', text: 'No departures found.' }] };
      }
      return { content: [{ type: 'text', text: formatServices(services, 'Departures') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${String(err instanceof Error ? err.message : err)}` }] };
    }
  }
);

// ─── Tool: get_arrivals ───────────────────────────────────────────────────────
server.tool(
  'get_arrivals',
  'Get live train arrivals at a station. Use search_stations to find the station ID first.',
  {
    station_id: z.string().describe('Station ID from search_stations'),
    country: z.string().describe('Country code: NO, SE, DK, DE, FR, GB, or CH'),
    limit: z.number().optional().describe('Max number of arrivals to return (default: 10)'),
  },
  async ({ station_id, country, limit = 10 }) => {
    try {
      const services = await registry.getArrivals(station_id, country, limit);
      if (services.length === 0) {
        return { content: [{ type: 'text', text: 'No arrivals found.' }] };
      }
      return { content: [{ type: 'text', text: formatServices(services, 'Arrivals') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${String(err instanceof Error ? err.message : err)}` }] };
    }
  }
);

// ─── Tool: get_journey ────────────────────────────────────────────────────────
server.tool(
  'get_journey',
  'Plan a train journey between two stations in the same country. Use search_stations to find station IDs first.',
  {
    origin_id: z.string().describe('Origin station ID from search_stations'),
    destination_id: z.string().describe('Destination station ID from search_stations'),
    country: z.string().describe('Country code: NO, SE, DK, DE, FR, GB, or CH'),
    datetime: z.string().optional().describe('Departure datetime in ISO 8601 format (e.g. 2024-03-15T14:30:00). Defaults to now.'),
  },
  async ({ origin_id, destination_id, country, datetime }) => {
    try {
      const dt = datetime ? new Date(datetime) : new Date();
      if (isNaN(dt.getTime())) {
        return { content: [{ type: 'text', text: `Invalid datetime: "${datetime}". Use ISO 8601 format, e.g. 2024-03-15T14:30:00` }] };
      }
      const journeys = await registry.getJourney(origin_id, destination_id, country, dt);
      if (journeys.length === 0) {
        return { content: [{ type: 'text', text: 'No journeys found.' }] };
      }
      return { content: [{ type: 'text', text: formatJourneys(journeys) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${String(err instanceof Error ? err.message : err)}` }] };
    }
  }
);

// ─── Tool: get_status ────────────────────────────────────────────────────────
server.tool(
  'get_status',
  'Show which European rail APIs are currently available and which require API keys.',
  {},
  async () => {
    return { content: [{ type: 'text', text: registry.statusReport() }] };
  }
);

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatStations(stations: Station[]): string {
  const byCountry = new Map<string, Station[]>();
  for (const s of stations) {
    const countryName = COUNTRY_NAMES[s.country] ?? s.country;
    if (!byCountry.has(countryName)) byCountry.set(countryName, []);
    byCountry.get(countryName)!.push(s);
  }

  const lines: string[] = [`Found ${stations.length} station(s):\n`];
  for (const [countryName, stns] of byCountry) {
    lines.push(`${countryName}:`);
    for (const s of stns) {
      lines.push(`  • ${s.name} (ID: ${s.id})`);
    }
  }
  return lines.join('\n');
}

function formatServices(services: TrainService[], title: string): string {
  const lines: string[] = [`${title} (${services.length} services):\n`];
  for (const s of services) {
    const timeStr = buildTimeStr(s.scheduledTime, s.actualTime, s.delayMinutes);
    const platform = s.platform ? ` | Platform ${s.platform}` : '';
    const cancelled = s.isCancelled ? ' [CANCELLED]' : '';
    const operator = s.operator ? ` (${s.operator})` : '';
    lines.push(
      `${timeStr}${cancelled}  ${s.trainNumber}${operator}` +
      `\n  → ${title === 'Departures' ? `to ${s.destination}` : `from ${s.origin}`}${platform}`
    );
  }
  return lines.join('\n');
}

function buildTimeStr(scheduled: string, actual?: string, delayMins?: number): string {
  if (!actual || actual === scheduled) {
    return scheduled;
  }
  if (delayMins && delayMins > 0) {
    return `${scheduled} (${actual}, +${delayMins}min)`;
  }
  return `${scheduled} (${actual})`;
}

function formatJourneys(journeys: Journey[]): string {
  const lines: string[] = [`Found ${journeys.length} journey option(s):\n`];
  journeys.forEach((j, i) => {
    const dur = j.durationMinutes > 0 ? ` | ${formatDuration(j.durationMinutes)}` : '';
    const changes = j.changes === 0 ? 'Direct' : `${j.changes} change${j.changes > 1 ? 's' : ''}`;
    lines.push(`Option ${i + 1}: ${j.departureTime} → ${j.arrivalTime}${dur} | ${changes}`);
    for (const leg of j.legs) {
      const op = leg.operator ? ` (${leg.operator})` : '';
      const plat = leg.platform ? ` from platform ${leg.platform}` : '';
      lines.push(`  ${leg.departureTime} ${leg.origin}${plat} → ${leg.arrivalTime} ${leg.destination}  [${leg.trainNumber}${op}]`);
    }
    if (i < journeys.length - 1) lines.push('');
  });
  return lines.join('\n');
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ─── Start server ─────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
