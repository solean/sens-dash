# Sensor Dashboard Plan

## Goal

Build a cloud-hosted dashboard for an Adafruit ESP32-S3 Reverse TFT Feather connected to STC4x CO2 and SHT41 temperature/humidity sensors.

The device should report current readings to a cloud backend, store historical measurements, and support a web dashboard with live values and historical charts.

## Recommended Architecture

Use:

- Vercel for the frontend web app
- Convex for the backend, database, realtime queries, and device ingestion endpoint
- ESP32 firmware that posts readings to Convex over HTTPS

Data flow:

```txt
ESP32-S3 Feather
  -> HTTPS POST to Convex HTTP endpoint
  -> Convex stores validated reading
  -> Vercel-hosted dashboard subscribes to Convex queries
  -> User views current readings and charts
```

This keeps the app mostly serverless while avoiding a custom API/database layer. Convex is the source of truth for readings, and Vercel only hosts the browser UI.

## Why Convex + Vercel

Benefits:

- Convex gives us backend functions, durable storage, and realtime subscriptions in one service.
- Vercel is a straightforward host for the React/Next.js dashboard.
- The ESP32 can send readings directly to a Convex HTTP action.
- The dashboard can update automatically when new readings arrive.
- We avoid managing Postgres, migrations, connection pooling, or a separate API server for the first version.

Tradeoffs:

- There are two cloud services instead of one.
- Convex uses its own document database model instead of SQL.
- If we later need heavy analytics, exports, or complex SQL-style reporting, we may want a separate analytics store.

For this project, the tradeoff is acceptable because the data volume is modest and realtime dashboard behavior is useful.

## Initial Product Scope

Version 1 should include:

- Current temperature, humidity, and CO2 cards
- Last reading timestamp and device online/offline status
- Historical chart for the last 24 hours
- Historical chart by day/week/month
- Average readings by hour of day
- Basic device authentication for ingestion
- Simple validation to reject impossible readings

Defer until later:

- User accounts
- Multi-user permissions
- Alerts and notifications
- Multiple dashboards
- CSV export
- Long-term rollup/retention jobs
- Local fallback storage on the device
- MQTT

## Frontend

Use a React-based app deployed on Vercel.

Suggested stack:

- Bun for package management
- Vite or Next.js for the web app
- Convex React client
- Recharts, uPlot, or Tremor/Recharts for charts
- Tailwind CSS or plain CSS modules for styling

Recommendation:

- Use Vite if this is only a dashboard and does not need SSR.
- Use Next.js if we expect auth, routing complexity, server-rendered pages, or Vercel-native API routes later.

For the first version, Vite + React is probably enough.

Suggested dashboard views:

- Overview
  - Current temperature
  - Current humidity
  - Current CO2
  - Last updated
  - Device status
- History
  - Time range selector: 24h, 7d, 30d, 90d
  - Line chart for CO2
  - Line chart for temperature and humidity
- Patterns
  - Average CO2 by hour of day
  - Average temperature by hour of day
  - Average humidity by hour of day

## Convex Backend

Convex responsibilities:

- Store readings
- Validate incoming device payloads
- Authenticate device ingestion requests
- Provide queries for dashboard data
- Provide aggregate/chart-friendly query results

Suggested Convex functions:

- `readings.ingest`
  - Internal mutation called by the HTTP action
  - Inserts validated sensor readings
- `readings.latest`
  - Returns the newest reading for a device
- `readings.recent`
  - Returns readings within a requested time window
- `readings.byDay`
  - Returns daily average/min/max values
- `readings.byMonth`
  - Returns monthly average/min/max values
- `readings.averageByHourOfDay`
  - Returns average values grouped by local hour

Suggested HTTP endpoint:

```txt
POST https://<convex-deployment>.convex.site/readings
```

Headers:

```txt
Authorization: Bearer <device-secret>
Content-Type: application/json
```

Payload:

```json
{
  "deviceId": "office-feather-01",
  "tempC": 22.7,
  "humidityPct": 41.2,
  "co2Ppm": 612
}
```

Use server-side timestamps for storage so readings have consistent time ordering.

## Data Model

Convex schema idea:

```ts
readings: defineTable({
  deviceId: v.string(),
  recordedAt: v.number(),
  tempC: v.number(),
  humidityPct: v.number(),
  co2Ppm: v.number(),
  source: v.optional(v.string()),
})
  .index("by_device_time", ["deviceId", "recordedAt"])
```

Device table:

```ts
devices: defineTable({
  deviceId: v.string(),
  name: v.string(),
  location: v.optional(v.string()),
  enabled: v.boolean(),
  createdAt: v.number(),
})
  .index("by_device_id", ["deviceId"])
```

Do not store the raw device secret in the database. Prefer an environment variable for the first version. If we later support multiple devices, store hashed per-device tokens.

## Validation Rules

Reject readings when:

- `deviceId` is missing or unknown
- `tempC` is outside a reasonable range, for example `-40` to `85`
- `humidityPct` is outside `0` to `100`
- `co2Ppm` is outside a reasonable range, for example `0` to `10000`
- Required fields are missing
- Authorization header is missing or invalid

Optionally mark readings as suspicious rather than rejecting them if the sensor sometimes returns transient bad data.

## ESP32 Firmware

Responsibilities:

- Read SHT41 temperature/humidity
- Read STC4x CO2
- Show local values on the TFT
- Connect to Wi-Fi
- POST readings to Convex on an interval
- Retry failed requests with backoff
- Avoid blocking sensor reads/UI updates during network failures

Initial reporting interval:

- Start with every 60 seconds
- Use every 5-15 minutes if long-term storage volume becomes a concern

Device request format:

```http
POST /readings HTTP/1.1
Host: <convex-deployment>.convex.site
Authorization: Bearer <device-secret>
Content-Type: application/json
```

Operational notes:

- Keep Wi-Fi SSID/password and device secret out of source control.
- Use HTTPS.
- Add serial logging for failed network requests.
- Consider showing upload status on the TFT.
- Use server time as canonical time; the ESP32 does not need accurate wall-clock time for v1.

Current firmware draft:

- `device/code.py`
- `device/settings.toml.example`

Required CircuitPython libraries on the Feather:

- `adafruit_display_text`
- `adafruit_stcc4`
- `adafruit_requests`

The cloud-enabled firmware reads Wi-Fi credentials, Convex ingestion URL, device ID, and device secret from `settings.toml`. It keeps the existing TFT display behavior and posts readings to Convex on a configurable interval.

## Historical Data Strategy

Raw readings are fine for the first version.

Approximate storage volume:

- 1 reading/minute = 1,440 readings/day
- 1 reading/minute = about 525,600 readings/year per device
- 1 reading/5 minutes = about 105,120 readings/year per device

Recommended starting point:

- Store raw readings every 60 seconds.
- Query raw readings directly for short ranges like 24h or 7d.
- Aggregate in Convex queries for medium ranges.
- Add precomputed rollups only if charts become slow.

Future rollup tables:

```txt
readingHourlyStats
readingDailyStats
readingMonthlyStats
```

Each rollup can store:

- count
- min/max/avg temperature
- min/max/avg humidity
- min/max/avg CO2
- bucket start timestamp
- deviceId

## Security

Version 1:

- Require a bearer token for the ingestion endpoint.
- Store the expected token in Convex environment variables.
- Keep the dashboard private by not publishing the URL broadly.

Version 2:

- Add user authentication.
- Add per-device tokens.
- Add token rotation.
- Add rate limiting or duplicate-read suppression.

## Deployment Plan

1. Create the web app scaffold.
2. Add Convex to the project.
3. Define Convex schema for `devices` and `readings`.
4. Implement Convex HTTP ingestion endpoint.
5. Implement Convex dashboard queries.
6. Build frontend overview screen with live latest readings.
7. Add historical charts.
8. Deploy frontend to Vercel.
9. Configure Convex deployment and environment variables.
10. Update ESP32 firmware to POST to the Convex HTTP endpoint.
11. Test live ingestion from the device.
12. Tune reporting interval and charts.

## Local Development

Use Bun where applicable.

Likely commands:

```sh
bun create vite . --template react-ts
bun add convex recharts
bunx convex dev
bun run dev
```

Exact commands may change depending on whether we choose Vite or Next.js.

## Open Questions

- Should the first dashboard be Vite or Next.js?
- Will there be one sensor device or multiple?
- Should the dashboard be public, password-protected, or local/private only?
- What reporting interval is acceptable?
- Do we want Fahrenheit display in addition to Celsius?
- Should CO2 thresholds be configurable?
- Should data be retained forever, or should old raw readings eventually be downsampled?

## Suggested First Implementation

Start with the smallest complete loop:

1. Build Vite + React dashboard.
2. Add Convex schema and ingestion HTTP action.
3. Add a local test script that posts fake readings.
4. Show latest values in the dashboard.
5. Add a 24-hour chart.
6. Deploy to Vercel and Convex.
7. Point the ESP32 at the production Convex endpoint.

Once that loop works, expand into richer charts, device management, and alerts.
