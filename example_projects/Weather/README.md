# Atmos Weather

Atmos Weather is a native SwiftUI weather app with a Node.js backend API.

## Project structure

```
Weather/
  app/       iOS app (Xcode project)
  backend/   API server (Hono + Node.js)
```

## Backend

Start the API server:

```bash
cd backend
npm install
npm run dev
```

The server runs on `http://localhost:3001` by default. Set `PORT` to change it.

## iOS app

Build and run with XcodeBuildMCP from the `app/` directory:

```bash
cd app
../../../build/cli.js simulator build-and-run
```

### Mock mode

Relaunch with mock data (no backend required):

```bash
../../../build/cli.js simulator launch-app \
  --bundle-id com.sentry.weather.Weather \
  --args=--mock-weather-api
```

### Tests

```bash
../../../build/cli.js simulator test
```

UI tests inject `--mock-weather-api` so they do not depend on the backend.

## API endpoints

The backend serves three `GET` endpoints under `/v1`:

| Purpose | Path | Params |
| --- | --- | --- |
| Default locations | `/v1/locations/default` | None |
| Search locations | `/v1/locations/search` | `?query=<string>` |
| Weather report | `/v1/weather/:locationID` | Path param |

### JSON schemas

Schema files in `app/Schemas/` describe the expected response shapes:

- `default-locations.schema.json`
- `search-locations.schema.json`
- `weather-report.schema.json`

### Test fixtures

Fixture JSON files in `app/WeatherTests/Fixtures/` are used by unit tests.
