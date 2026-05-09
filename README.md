# Air Monitor

Cloud dashboard for an Adafruit ESP32-S3 Reverse TFT Feather connected to STC4x CO2 and SHT41 temperature/humidity sensors.

## Stack

- Vite + React frontend
- Convex backend, database, realtime queries, and HTTP ingestion endpoint
- Vercel frontend hosting
- Bun for package management
- CircuitPython firmware in `device/`

## Local Setup

Install dependencies:

```sh
bun install
```

Start Convex:

```sh
bun run convex:dev
```

Start the frontend in another terminal:

```sh
bun run dev
```

The local dashboard runs at:

```txt
http://127.0.0.1:5173/
```

## Environment

Convex creates `.env.local` during setup. The frontend needs:

```txt
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
VITE_DEFAULT_DEVICE_ID=office-feather-01
```

The ingestion endpoint also requires Convex environment variables:

```sh
bunx convex env set SENSOR_DEVICE_ID office-feather-01
bunx convex env set SENSOR_DEVICE_SECRET replace-with-a-long-random-secret
```

For local fake-reading tests, `.env.local` also needs:

```txt
SENSOR_DEVICE_ID=office-feather-01
SENSOR_DEVICE_SECRET=replace-with-a-long-random-secret
```

Do not commit `.env.local`.

## Ingestion Endpoint

The device posts to:

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

## Test Ingestion

With Convex running locally:

```sh
bun run post-fake-reading
```

This posts one synthetic reading through the same HTTP route the Feather uses.

## Firmware

Firmware files:

- `device/code.py`
- `device/settings.toml.example`

Copy the example settings into `CIRCUITPY/settings.toml` on the Feather and fill in real values:

```txt
CIRCUITPY_WIFI_SSID = "your-wifi-name"
CIRCUITPY_WIFI_PASSWORD = "your-wifi-password"
CONVEX_INGEST_URL = "https://your-convex-deployment.convex.site/readings"
SENSOR_DEVICE_ID = "office-feather-01"
SENSOR_DEVICE_SECRET = "replace-with-a-long-random-secret"
SENSOR_READ_INTERVAL_SECONDS = 5
SENSOR_POST_INTERVAL_SECONDS = 300
```

The screen refreshes every 5 seconds. Cloud uploads happen every 5 minutes.

Required CircuitPython libraries:

- `adafruit_display_text`
- `adafruit_stcc4`
- `adafruit_requests`

Install them with `circup` while the Feather is mounted:

```sh
circup install adafruit_stcc4 adafruit_display_text adafruit_requests
```

## Verification

Useful checks:

```sh
bun run lint
bun run build
bunx convex run readings:latest '{"deviceId":"office-feather-01"}'
```

## Deployment

Convex:

```sh
bunx convex login
bun run convex:deploy
```

Set production Convex env vars:

```sh
bunx convex env set SENSOR_DEVICE_ID office-feather-01 --prod
bunx convex env set SENSOR_DEVICE_SECRET replace-with-a-long-random-secret --prod
```

Vercel:

- Import the repo into Vercel.
- Set `VITE_CONVEX_URL` to the production Convex client URL.
- Set `VITE_CONVEX_SITE_URL` to the production Convex HTTP actions URL.
- Set `VITE_DEFAULT_DEVICE_ID` to `office-feather-01`.
- Build command: `bun run build`
- Output directory: `dist`
