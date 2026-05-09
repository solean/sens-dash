const ingestUrl =
  process.env.CONVEX_INGEST_URL ??
  (process.env.VITE_CONVEX_SITE_URL
    ? `${process.env.VITE_CONVEX_SITE_URL}/readings`
    : undefined);
const deviceSecret = process.env.SENSOR_DEVICE_SECRET;
const deviceId = process.env.SENSOR_DEVICE_ID ?? "office-feather-01";

if (!ingestUrl || !deviceSecret) {
  console.error(
    "Missing CONVEX_INGEST_URL or SENSOR_DEVICE_SECRET environment variable.",
  );
  process.exit(1);
}

const now = Date.now();
const payload = {
  deviceId,
  tempC: 22 + Math.sin(now / 1000 / 60) * 1.4,
  humidityPct: 42 + Math.cos(now / 1000 / 90) * 4,
  co2Ppm: Math.round(610 + Math.sin(now / 1000 / 45) * 80),
};

const response = await fetch(ingestUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${deviceSecret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const text = await response.text();

console.log(response.status, text);

if (!response.ok) {
  process.exit(1);
}
