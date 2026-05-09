import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

declare const process: {
  env: Record<string, string | undefined>;
};

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/readings",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("authorization") ?? "";
    const expectedSecret = process.env.SENSOR_DEVICE_SECRET;
    const expectedDeviceId = process.env.SENSOR_DEVICE_ID;

    if (!expectedSecret) {
      return jsonResponse({ error: "Device secret is not configured" }, 500);
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = parseReading(body);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400);
    }

    if (expectedDeviceId && parsed.reading.deviceId !== expectedDeviceId) {
      return jsonResponse({ error: "Unknown device" }, 403);
    }

    const result = await ctx.runMutation(internal.readings.ingest, parsed.reading);

    return jsonResponse({ ok: true, recordedAt: result.recordedAt }, 201);
  }),
});

export default http;

function parseReading(body: unknown):
  | {
      ok: true;
      reading: {
        deviceId: string;
        tempC: number;
        humidityPct: number;
        co2Ppm: number;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be an object" };
  }

  const payload = body as Record<string, unknown>;
  const deviceId = payload.deviceId;
  const tempC = payload.tempC;
  const humidityPct = payload.humidityPct;
  const co2Ppm = payload.co2Ppm;

  if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
    return { ok: false, error: "deviceId is required" };
  }

  if (!isFiniteNumber(tempC) || tempC < -40 || tempC > 85) {
    return { ok: false, error: "tempC is outside the accepted range" };
  }

  if (!isFiniteNumber(humidityPct) || humidityPct < 0 || humidityPct > 100) {
    return { ok: false, error: "humidityPct is outside the accepted range" };
  }

  if (!isFiniteNumber(co2Ppm) || co2Ppm < 0 || co2Ppm > 10000) {
    return { ok: false, error: "co2Ppm is outside the accepted range" };
  }

  return {
    ok: true,
    reading: {
      deviceId: deviceId.trim(),
      tempC,
      humidityPct,
      co2Ppm,
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
