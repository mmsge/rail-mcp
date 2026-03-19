# rail-mcp

An MCP (Model Context Protocol) server that provides **live train times across Europe**, covering Norway, Sweden, Denmark, Germany, France, the United Kingdom, and Switzerland.

## Tools

| Tool | Description |
|------|-------------|
| `search_stations` | Search for stations by name across Europe (or in a specific country) |
| `get_departures` | Live departures from a station |
| `get_arrivals` | Live arrivals at a station |
| `get_journey` | Plan a journey between two stations |
| `get_status` | Show which country APIs are available |

## Country Coverage

| Country | API | Auth Required |
|---------|-----|---------------|
| Germany (DE) | [db.transport.rest](https://v6.db.transport.rest) | None |
| United Kingdom (GB) | [Huxley2](https://huxley2.azurewebsites.net) | None |
| Norway (NO) | [Entur](https://developer.entur.org) | None (header only) |
| Denmark (DK) | [Rejseplanen](https://rejseplanen.dk) | None |
| Switzerland (CH) | [opendata.ch](https://transport.opendata.ch) | None |
| Sweden (SE) | [Trafiklab ResRobot](https://www.trafiklab.se) | `TRAFIKLAB_API_KEY` |
| France (FR) | [SNCF API](https://numerique.sncf.com) | `SNCF_API_KEY` |

Germany, UK, Norway, Denmark, and Switzerland work **without any API keys**. Sweden and France require free API keys.

## Setup

### 1. Install & Build

```bash
npm install
npm run build
```

### 2. API Keys (optional)

Copy `.env.example` to `.env` and fill in any keys you want:

```bash
cp .env.example .env
```

- **Sweden** — Get a free key at [trafiklab.se](https://www.trafiklab.se/api/trafiklab-apis/resrobot-v21/)
- **France** — Get a free key at [numerique.sncf.com](https://numerique.sncf.com/startup/api/)

### 3. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rail": {
      "command": "node",
      "args": ["/absolute/path/to/rail-mcp/dist/index.js"],
      "env": {
        "TRAFIKLAB_API_KEY": "your-key-here",
        "SNCF_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Example Usage

```
# Find stations
search_stations(query="Oslo")
search_stations(query="Berlin Hbf", country="DE")
search_stations(query="London", country="GB")

# Get live departures
get_departures(station_id="NSR:StopPlace:337", country="NO", limit=10)
get_departures(station_id="8098160", country="DE", limit=15)

# Get arrivals
get_arrivals(station_id="BHM", country="GB")

# Plan a journey
get_journey(origin_id="NSR:StopPlace:337", destination_id="NSR:StopPlace:548", country="NO")
get_journey(origin_id="8098160", destination_id="8000105", country="DE", datetime="2024-03-15T09:00:00")

# Check which APIs are active
get_status()
```

## Development

```bash
npm run dev   # Run with tsx (no build step)
npm run build # Compile to dist/
npm start     # Run compiled output
```

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
