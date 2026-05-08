import { Hono } from "hono";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";

const app = new Hono().basePath("/v1");

app.use(logger());

// ---------------------------------------------------------------------------
// GET /v1/locations/default
// ---------------------------------------------------------------------------

app.get("/locations/default", (c) => {
  return c.json({ locations: defaultLocations });
});

// ---------------------------------------------------------------------------
// GET /v1/locations/search?query=<string>
// ---------------------------------------------------------------------------

app.get("/locations/search", (c) => {
  const query = (c.req.query("query") ?? "").trim().toLowerCase();
  if (!query) return c.json({ locations: [] });

  const matches = searchPool.filter(
    (loc) =>
      loc.name.toLowerCase().includes(query) ||
      loc.subtitle.toLowerCase().includes(query) ||
      (loc.country?.toLowerCase().includes(query) ?? false),
  );
  return c.json({ locations: matches });
});

// ---------------------------------------------------------------------------
// GET /v1/weather/:locationID
// ---------------------------------------------------------------------------

app.get("/weather/:locationID", (c) => {
  const locationID = c.req.param("locationID");
  const scenario = scenarioByLocationID[locationID];

  if (!scenario) {
    return c.json({ error: "Unknown location" }, 404);
  }

  const current = currentWeather[scenario];
  const hourly = hourlyForecast[scenario];
  const daily = dailyForecast[scenario];
  const precipDetail = getPrecipitationDetail(scenario);

  return c.json({
    current: { ...current, id: `weather-current-${locationID}` },
    hourly,
    daily,
    precipitationDetailCurrent: {
      ...precipDetail,
      id: `weather-precip-${locationID}`,
    },
  });
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type Scenario = "clearDay" | "rainy" | "snowy" | "night" | "stormy";

const scenarioByLocationID: Record<string, Scenario> = {
  "loc-current-san-francisco": "clearDay",
  "loc-us-or-portland": "rainy",
  "loc-us-co-aspen": "snowy",
  "loc-is-reykjavik": "night",
  "loc-us-la-new-orleans": "stormy",
  "loc-jp-tokyo": "clearDay",
  "loc-pt-lisbon": "clearDay",
  "loc-fr-paris": "clearDay",
  "loc-gb-london": "rainy",
  "loc-de-berlin": "rainy",
  "loc-us-ny-new-york": "clearDay",
  "loc-au-sydney": "clearDay",
  "loc-sg-singapore": "stormy",
  "loc-in-mumbai": "clearDay",
  "loc-eg-cairo": "clearDay",
  "loc-za-cape-town": "clearDay",
  "loc-is-capital-reykjavik": "night",
  "loc-no-oslo": "snowy",
  "loc-se-stockholm": "rainy",
  "loc-ca-vancouver": "rainy",
  "loc-ca-toronto": "rainy",
  "loc-mx-mexico-city": "clearDay",
  "loc-ar-buenos-aires": "clearDay",
  "loc-kr-seoul": "clearDay",
  "loc-th-bangkok": "stormy",
  "loc-ae-dubai": "clearDay",
  "loc-es-madrid": "clearDay",
};

const defaultLocations = [
  loc("loc-current-san-francisco", "San Francisco", "Current Location", null, 18, 20, 12, "mostly_sunny", 13, 24),
  loc("loc-us-or-portland", "Portland", "Oregon, USA", null, 11, 13, 9, "light_rain", 13, 24),
  loc("loc-us-co-aspen", "Aspen", "Colorado, USA", null, -4, -2, -10, "light_snow", 14, 24),
  loc("loc-is-reykjavik", "Reykjavík", "Iceland", null, 3, 6, 1, "clear_night", 20, 24),
  loc("loc-us-la-new-orleans", "New Orleans", "Louisiana, USA", null, 22, 26, 20, "thunderstorms", 15, 24),
  loc("loc-jp-tokyo", "Tokyo", "Japan", null, 14, 17, 11, "partly_cloudy", 5, 24),
  loc("loc-pt-lisbon", "Lisbon", "Portugal", null, 19, 22, 14, "sunny", 21, 24),
];

const searchPool = [
  loc("loc-fr-paris", "Paris", "Île-de-France, France", "FR", 15, 18, 11, "partly_cloudy", 22, 24),
  loc("loc-gb-london", "London", "England, United Kingdom", "GB", 13, 16, 9, "light_rain", 21, 24),
  loc("loc-de-berlin", "Berlin", "Germany", "DE", 11, 14, 7, "cloudy", 22, 24),
  loc("loc-us-ny-new-york", "New York", "New York, USA", "US", 16, 19, 12, "sunny", 16, 24),
  loc("loc-au-sydney", "Sydney", "New South Wales, Australia", "AU", 22, 25, 18, "sunny", 6, 24),
  loc("loc-sg-singapore", "Singapore", "Singapore", "SG", 29, 31, 26, "thunderstorms", 4, 24),
  loc("loc-in-mumbai", "Mumbai", "Maharashtra, India", "IN", 31, 33, 26, "hazy", 1, 54),
  loc("loc-eg-cairo", "Cairo", "Egypt", "EG", 28, 32, 19, "sunny", 23, 24),
  loc("loc-za-cape-town", "Cape Town", "Western Cape, South Africa", "ZA", 20, 23, 14, "mostly_sunny", 23, 24),
  loc("loc-is-capital-reykjavik", "Reykjavík", "Capital Region, Iceland", "IS", 3, 6, 1, "clear_night", 20, 24),
  loc("loc-no-oslo", "Oslo", "Norway", "NO", 5, 8, 1, "snow_showers", 22, 24),
  loc("loc-se-stockholm", "Stockholm", "Sweden", "SE", 6, 9, 2, "partly_cloudy", 22, 24),
  loc("loc-ca-vancouver", "Vancouver", "British Columbia, Canada", "CA", 9, 12, 6, "light_rain", 13, 24),
  loc("loc-ca-toronto", "Toronto", "Ontario, Canada", "CA", 8, 12, 5, "cloudy", 16, 24),
  loc("loc-mx-mexico-city", "Mexico City", "Mexico", "MX", 22, 26, 13, "sunny", 14, 24),
  loc("loc-ar-buenos-aires", "Buenos Aires", "Argentina", "AR", 18, 21, 13, "partly_cloudy", 17, 24),
  loc("loc-kr-seoul", "Seoul", "South Korea", "KR", 13, 17, 8, "clear_day", 5, 24),
  loc("loc-th-bangkok", "Bangkok", "Thailand", "TH", 32, 34, 26, "thunderstorms", 3, 24),
  loc("loc-ae-dubai", "Dubai", "United Arab Emirates", "AE", 33, 37, 26, "sunny", 0, 24),
  loc("loc-es-madrid", "Madrid", "Spain", "ES", 19, 22, 12, "sunny", 22, 24),
];

function loc(
  id: string, name: string, subtitle: string, country: string | null,
  temperatureC: number, highC: number, lowC: number,
  condition: string, hour: number, minute: number,
) {
  return { id, name, subtitle, country, temperatureC, highC, lowC, condition, localTime: { hour, minute } };
}

// ---------------------------------------------------------------------------
// Weather data by scenario
// ---------------------------------------------------------------------------

const currentWeather: Record<Scenario, object> = {
  clearDay: {
    id: "", temperatureC: 18, highC: 20, lowC: 12, feelsLikeC: 17, dewPointC: 9,
    condition: "mostly_sunny",
    solarProgress: { kind: "daylight", daylightFraction: 0.62 },
    sunrise: { hour: 6, minute: 18 }, sunset: { hour: 19, minute: 42 },
    airQualityIndex: 38, airQualityCategory: "good",
    uvIndex: 6, uvCategory: "high",
    windKph: 13, windDirectionDegrees: 292, humidity: 64,
    visibilityKilometers: 16.1, pressureMillibars: 1018, pressureTrend: "rising", precipChance: 5,
  },
  rainy: {
    id: "", temperatureC: 11, highC: 13, lowC: 9, feelsLikeC: 9, dewPointC: 8,
    condition: "light_rain",
    solarProgress: { kind: "daylight", daylightFraction: 0.45 },
    sunrise: { hour: 6, minute: 42 }, sunset: { hour: 19, minute: 18 },
    airQualityIndex: 22, airQualityCategory: "good",
    uvIndex: 1, uvCategory: "low",
    windKph: 23, windDirectionDegrees: 225, humidity: 89,
    visibilityKilometers: 9.7, pressureMillibars: 1006, pressureTrend: "falling", precipChance: 78,
  },
  snowy: {
    id: "", temperatureC: -4, highC: -2, lowC: -10, feelsLikeC: -8, dewPointC: -7,
    condition: "light_snow",
    solarProgress: { kind: "daylight", daylightFraction: 0.50 },
    sunrise: { hour: 7, minute: 14 }, sunset: { hour: 17, minute: 38 },
    airQualityIndex: 18, airQualityCategory: "good",
    uvIndex: 2, uvCategory: "low",
    windKph: 10, windDirectionDegrees: 0, humidity: 78,
    visibilityKilometers: 6.4, pressureMillibars: 1022, pressureTrend: "steady", precipChance: 65,
  },
  night: {
    id: "", temperatureC: 3, highC: 6, lowC: 1, feelsLikeC: 1, dewPointC: 0,
    condition: "clear_night",
    solarProgress: { kind: "after_sunset", daylightFraction: null },
    sunrise: { hour: 5, minute: 46 }, sunset: { hour: 20, minute: 24 },
    airQualityIndex: 12, airQualityCategory: "good",
    uvIndex: 0, uvCategory: "none",
    windKph: 6, windDirectionDegrees: 45, humidity: 71,
    visibilityKilometers: 16.1, pressureMillibars: 1014, pressureTrend: "steady", precipChance: 8,
  },
  stormy: {
    id: "", temperatureC: 22, highC: 26, lowC: 20, feelsLikeC: 24, dewPointC: 19,
    condition: "thunderstorms",
    solarProgress: { kind: "daylight", daylightFraction: 0.78 },
    sunrise: { hour: 6, minute: 8 }, sunset: { hour: 19, minute: 52 },
    airQualityIndex: 55, airQualityCategory: "moderate",
    uvIndex: 3, uvCategory: "moderate",
    windKph: 35, windDirectionDegrees: 180, humidity: 86,
    visibilityKilometers: 4.8, pressureMillibars: 998, pressureTrend: "falling", precipChance: 92,
  },
};

function h(kind: "current" | "clock", temp: number, condition: string, hour?: number, minute?: number) {
  const id = kind === "current"
    ? `hourly-now-${temp}-${condition}`
    : `hourly-${hour}-${minute}-${temp}-${condition}`;
  return { id, hour: { kind, hour: hour ?? null, minute: minute ?? null }, temperatureC: temp, condition };
}

const hourlyForecast: Record<Scenario, object[]> = {
  clearDay: [
    h("current", 18, "sunny"), h("clock", 19, "sunny", 14, 0), h("clock", 19, "sunny", 15, 0),
    h("clock", 20, "sunny", 16, 0), h("clock", 19, "sunny", 17, 0), h("clock", 18, "partly_cloudy", 18, 0),
    h("clock", 17, "partly_cloudy", 19, 0), h("clock", 16, "clear_night", 20, 0),
    h("clock", 14, "clear_night", 21, 0), h("clock", 13, "clear_night", 22, 0),
    h("clock", 13, "clear_night", 23, 0), h("clock", 12, "clear_night", 0, 0),
  ],
  rainy: [
    h("current", 11, "light_rain"), h("clock", 12, "light_rain", 14, 0), h("clock", 12, "light_rain", 15, 0),
    h("clock", 13, "heavy_rain", 16, 0), h("clock", 12, "heavy_rain", 17, 0), h("clock", 12, "light_rain", 18, 0),
    h("clock", 11, "light_rain", 19, 0), h("clock", 11, "cloudy", 20, 0),
    h("clock", 10, "cloudy", 21, 0), h("clock", 9, "cloudy", 22, 0),
    h("clock", 9, "light_rain", 23, 0), h("clock", 9, "light_rain", 0, 0),
  ],
  snowy: [
    h("current", -4, "light_snow"), h("clock", -3, "light_snow", 14, 0), h("clock", -3, "light_snow", 15, 0),
    h("clock", -2, "cloudy", 16, 0), h("clock", -3, "cloudy", 17, 0), h("clock", -4, "light_snow", 18, 0),
    h("clock", -6, "light_snow", 19, 0), h("clock", -7, "light_snow", 20, 0),
    h("clock", -8, "light_snow", 21, 0), h("clock", -9, "cloudy", 22, 0),
    h("clock", -9, "cloudy", 23, 0), h("clock", -10, "clear_night", 0, 0),
  ],
  night: [
    h("current", 3, "clear_night"), h("clock", 3, "clear_night", 23, 0), h("clock", 2, "clear_night", 0, 0),
    h("clock", 2, "clear_night", 1, 0), h("clock", 1, "clear_night", 2, 0), h("clock", 1, "clear_night", 3, 0),
    h("clock", 1, "clear_night", 4, 0), h("clock", 1, "clear_night", 5, 0),
    h("clock", 2, "partly_cloudy", 6, 0), h("clock", 3, "sunny", 7, 0),
    h("clock", 4, "sunny", 8, 0), h("clock", 6, "sunny", 9, 0),
  ],
  stormy: [
    h("current", 22, "thunderstorms"), h("clock", 23, "thunderstorms", 14, 0), h("clock", 24, "heavy_rain", 15, 0),
    h("clock", 24, "heavy_rain", 16, 0), h("clock", 26, "thunderstorms", 17, 0), h("clock", 26, "thunderstorms", 18, 0),
    h("clock", 25, "light_rain", 19, 0), h("clock", 23, "light_rain", 20, 0),
    h("clock", 22, "cloudy", 21, 0), h("clock", 21, "cloudy", 22, 0),
    h("clock", 21, "cloudy", 23, 0), h("clock", 20, "cloudy", 0, 0),
  ],
};

function d(kind: "today" | "weekday", condition: string, low: number, high: number, weekLow: number, weekHigh: number, weekdayRawValue?: number) {
  const dayPart = kind === "today" ? "today" : `weekday-${weekdayRawValue}`;
  return {
    id: `daily-${dayPart}-${condition}-${low}-${high}`,
    day: { kind, weekdayRawValue: weekdayRawValue ?? null },
    condition, lowC: low, highC: high, weekLowC: weekLow, weekHighC: weekHigh,
  };
}

const dailyForecast: Record<Scenario, object[]> = {
  clearDay: [
    d("today", "sunny", 12, 20, 9, 23),
    d("weekday", "sunny", 13, 21, 9, 23, 4),
    d("weekday", "partly_cloudy", 13, 21, 9, 23, 5),
    d("weekday", "cloudy", 11, 19, 9, 23, 6),
    d("weekday", "light_rain", 9, 16, 9, 23, 7),
    d("weekday", "light_rain", 9, 14, 9, 23, 1),
    d("weekday", "sunny", 11, 19, 9, 23, 2),
  ],
  rainy: [
    d("today", "light_rain", 9, 13, 6, 17),
    d("weekday", "light_rain", 8, 12, 6, 17, 4),
    d("weekday", "cloudy", 8, 13, 6, 17, 5),
    d("weekday", "cloudy", 9, 14, 6, 17, 6),
    d("weekday", "partly_cloudy", 10, 17, 6, 17, 7),
    d("weekday", "sunny", 9, 16, 6, 17, 1),
    d("weekday", "light_rain", 6, 12, 6, 17, 2),
  ],
  snowy: [
    d("today", "light_snow", -10, -2, -13, 1),
    d("weekday", "light_snow", -11, -3, -13, 1, 4),
    d("weekday", "cloudy", -9, -1, -13, 1, 5),
    d("weekday", "partly_cloudy", -7, 1, -13, 1, 6),
    d("weekday", "sunny", -8, 0, -13, 1, 7),
    d("weekday", "light_snow", -12, -6, -13, 1, 1),
    d("weekday", "light_snow", -13, -8, -13, 1, 2),
  ],
  night: [
    d("today", "clear_night", 1, 6, -1, 9),
    d("weekday", "sunny", 2, 8, -1, 9, 4),
    d("weekday", "cloudy", 2, 7, -1, 9, 5),
    d("weekday", "light_rain", 1, 5, -1, 9, 6),
    d("weekday", "light_rain", 0, 4, -1, 9, 7),
    d("weekday", "sunny", 2, 8, -1, 9, 1),
    d("weekday", "sunny", 3, 9, -1, 9, 2),
  ],
  stormy: [
    d("today", "thunderstorms", 20, 26, 18, 31),
    d("weekday", "light_rain", 21, 28, 18, 31, 4),
    d("weekday", "cloudy", 22, 29, 18, 31, 5),
    d("weekday", "partly_cloudy", 22, 30, 18, 31, 6),
    d("weekday", "sunny", 23, 31, 18, 31, 7),
    d("weekday", "sunny", 21, 29, 18, 31, 1),
    d("weekday", "thunderstorms", 19, 24, 18, 31, 2),
  ],
};

interface PrecipDetail {
  id: string;
  temperatureC: number;
  highC: number;
  lowC: number;
  feelsLikeC: number;
  dewPointC: number;
  condition: string;
  solarProgress: { kind: string; daylightFraction: number | null };
  sunrise: { hour: number; minute: number };
  sunset: { hour: number; minute: number };
  airQualityIndex: number;
  airQualityCategory: string;
  uvIndex: number;
  uvCategory: string;
  windKph: number;
  windDirectionDegrees: number;
  humidity: number;
  visibilityKilometers: number;
  pressureMillibars: number;
  pressureTrend: string;
  precipChance: number;
}

function getPrecipitationDetail(scenario: Scenario): PrecipDetail {
  const detail = precipitationDetail[scenario]!;
  return {
    ...detail,
    precipChance: Math.round(detail.precipChance),
  };
}

const precipitationDetail: Partial<Record<Scenario, PrecipDetail>> = {
  clearDay: {
    id: "", temperatureC: 18, highC: 20, lowC: 12, feelsLikeC: 17, dewPointC: 9,
    condition: "mostly_sunny",
    solarProgress: { kind: "daylight", daylightFraction: 0.62 },
    sunrise: { hour: 6, minute: 18 }, sunset: { hour: 19, minute: 42 },
    airQualityIndex: 38, airQualityCategory: "good",
    uvIndex: 6, uvCategory: "high",
    windKph: 13, windDirectionDegrees: 292, humidity: 64,
    visibilityKilometers: 16.1, pressureMillibars: 1018, pressureTrend: "rising", precipChance: 5,
  },
  snowy: {
    id: "", temperatureC: -4, highC: -2, lowC: -10, feelsLikeC: -8, dewPointC: -7,
    condition: "light_snow",
    solarProgress: { kind: "daylight", daylightFraction: 0.50 },
    sunrise: { hour: 7, minute: 14 }, sunset: { hour: 17, minute: 38 },
    airQualityIndex: 18, airQualityCategory: "good",
    uvIndex: 2, uvCategory: "low",
    windKph: 10, windDirectionDegrees: 0, humidity: 78,
    visibilityKilometers: 6.4, pressureMillibars: 1022, pressureTrend: "steady", precipChance: 65,
  },
  night: {
    id: "", temperatureC: 3, highC: 6, lowC: 1, feelsLikeC: 1, dewPointC: 0,
    condition: "clear_night",
    solarProgress: { kind: "after_sunset", daylightFraction: null },
    sunrise: { hour: 5, minute: 46 }, sunset: { hour: 20, minute: 24 },
    airQualityIndex: 12, airQualityCategory: "good",
    uvIndex: 0, uvCategory: "none",
    windKph: 6, windDirectionDegrees: 45, humidity: 71,
    visibilityKilometers: 16.1, pressureMillibars: 1014, pressureTrend: "steady", precipChance: 8,
  },
  stormy: {
    id: "", temperatureC: 22, highC: 26, lowC: 20, feelsLikeC: 24, dewPointC: 19,
    condition: "thunderstorms",
    solarProgress: { kind: "daylight", daylightFraction: 0.78 },
    sunrise: { hour: 6, minute: 8 }, sunset: { hour: 19, minute: 52 },
    airQualityIndex: 55, airQualityCategory: "moderate",
    uvIndex: 3, uvCategory: "moderate",
    windKph: 35, windDirectionDegrees: 180, humidity: 86,
    visibilityKilometers: 4.8, pressureMillibars: 998, pressureTrend: "falling", precipChance: 92,
  },
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? "3001", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Atmos Weather API running on http://localhost:${info.port}`);
});
