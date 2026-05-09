import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";

const DEFAULT_DEVICE_ID = "office-feather-01";

type RawReading = {
  recordedAt: number;
  tempC: number;
  humidityPct: number;
  co2Ppm: number;
};

type BucketStats = {
  key: string;
  label: string;
  sortValue: number;
  count: number;
  tempTotal: number;
  humidityTotal: number;
  co2Total: number;
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  co2Min: number;
  co2Max: number;
};

const readingArgs = {
  deviceId: v.string(),
  tempC: v.number(),
  humidityPct: v.number(),
  co2Ppm: v.number(),
};

export const ingest = internalMutation({
  args: readingArgs,
  handler: async (ctx, args) => {
    const recordedAt = Date.now();

    await ctx.db.insert("readings", {
      deviceId: args.deviceId,
      recordedAt,
      tempC: args.tempC,
      humidityPct: args.humidityPct,
      co2Ppm: args.co2Ppm,
    });

    return { recordedAt };
  },
});

export const latest = query({
  args: {
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deviceId = args.deviceId ?? DEFAULT_DEVICE_ID;

    return await ctx.db
      .query("readings")
      .withIndex("by_device_time", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .first();
  },
});

export const recent = query({
  args: {
    deviceId: v.optional(v.string()),
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deviceId = args.deviceId ?? DEFAULT_DEVICE_ID;
    const limit = Math.min(args.limit ?? 2000, 5000);
    const readings = await ctx.db
      .query("readings")
      .withIndex("by_device_time", (q) =>
        q
          .eq("deviceId", deviceId)
          .gte("recordedAt", args.from)
          .lte("recordedAt", args.to),
      )
      .order("desc")
      .take(limit);

    return readings.reverse();
  },
});

export const aggregate = query({
  args: {
    deviceId: v.optional(v.string()),
    from: v.number(),
    to: v.number(),
    bucket: v.union(v.literal("hour"), v.literal("day"), v.literal("month")),
    timeZone: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deviceId = args.deviceId ?? DEFAULT_DEVICE_ID;
    const timeZone = args.timeZone ?? "America/Phoenix";
    const limit = Math.min(args.limit ?? 10000, 20000);
    const readings = await ctx.db
      .query("readings")
      .withIndex("by_device_time", (q) =>
        q
          .eq("deviceId", deviceId)
          .gte("recordedAt", args.from)
          .lte("recordedAt", args.to),
      )
      .order("desc")
      .take(limit);

    const buckets = new Map<string, BucketStats>();

    for (const reading of readings) {
      const bucket = getBucket(reading, args.bucket, timeZone);
      const existing = buckets.get(bucket.key);

      if (!existing) {
        buckets.set(bucket.key, {
          ...bucket,
          count: 1,
          tempTotal: reading.tempC,
          humidityTotal: reading.humidityPct,
          co2Total: reading.co2Ppm,
          tempMin: reading.tempC,
          tempMax: reading.tempC,
          humidityMin: reading.humidityPct,
          humidityMax: reading.humidityPct,
          co2Min: reading.co2Ppm,
          co2Max: reading.co2Ppm,
        });
        continue;
      }

      existing.count += 1;
      existing.tempTotal += reading.tempC;
      existing.humidityTotal += reading.humidityPct;
      existing.co2Total += reading.co2Ppm;
      existing.tempMin = Math.min(existing.tempMin, reading.tempC);
      existing.tempMax = Math.max(existing.tempMax, reading.tempC);
      existing.humidityMin = Math.min(existing.humidityMin, reading.humidityPct);
      existing.humidityMax = Math.max(existing.humidityMax, reading.humidityPct);
      existing.co2Min = Math.min(existing.co2Min, reading.co2Ppm);
      existing.co2Max = Math.max(existing.co2Max, reading.co2Ppm);
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.sortValue - b.sortValue)
      .map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: bucket.count,
        tempAvgC: bucket.tempTotal / bucket.count,
        humidityAvgPct: bucket.humidityTotal / bucket.count,
        co2AvgPpm: bucket.co2Total / bucket.count,
        tempMinC: bucket.tempMin,
        tempMaxC: bucket.tempMax,
        humidityMinPct: bucket.humidityMin,
        humidityMaxPct: bucket.humidityMax,
        co2MinPpm: bucket.co2Min,
        co2MaxPpm: bucket.co2Max,
      }));
  },
});

export const averageByHourOfDay = query({
  args: {
    deviceId: v.optional(v.string()),
    from: v.number(),
    to: v.number(),
    timeZone: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deviceId = args.deviceId ?? DEFAULT_DEVICE_ID;
    const timeZone = args.timeZone ?? "America/Phoenix";
    const limit = Math.min(args.limit ?? 20000, 30000);
    const readings = await ctx.db
      .query("readings")
      .withIndex("by_device_time", (q) =>
        q
          .eq("deviceId", deviceId)
          .gte("recordedAt", args.from)
          .lte("recordedAt", args.to),
      )
      .order("desc")
      .take(limit);

    const hourFormat = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    });
    const buckets = new Map<
      number,
      {
        hour: number;
        count: number;
        tempTotal: number;
        humidityTotal: number;
        co2Total: number;
      }
    >();

    for (const reading of readings) {
      const hour = Number(hourFormat.format(new Date(reading.recordedAt)));
      const existing = buckets.get(hour);

      if (!existing) {
        buckets.set(hour, {
          hour,
          count: 1,
          tempTotal: reading.tempC,
          humidityTotal: reading.humidityPct,
          co2Total: reading.co2Ppm,
        });
        continue;
      }

      existing.count += 1;
      existing.tempTotal += reading.tempC;
      existing.humidityTotal += reading.humidityPct;
      existing.co2Total += reading.co2Ppm;
    }

    return Array.from({ length: 24 }, (_, hour) => {
      const bucket = buckets.get(hour);
      return {
        hour,
        label: formatHour(hour),
        count: bucket?.count ?? 0,
        tempAvgC: bucket ? bucket.tempTotal / bucket.count : null,
        humidityAvgPct: bucket ? bucket.humidityTotal / bucket.count : null,
        co2AvgPpm: bucket ? bucket.co2Total / bucket.count : null,
      };
    });
  },
});

function getBucket(
  reading: RawReading,
  bucket: "hour" | "day" | "month",
  timeZone: string,
) {
  const date = new Date(reading.recordedAt);

  if (bucket === "hour") {
    const parts = dateParts(date, timeZone);
    return {
      key: `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`,
      label: `${parts.month}/${parts.day} ${formatHour(Number(parts.hour))}`,
      sortValue: Number(
        `${parts.year}${parts.month.padStart(2, "0")}${parts.day.padStart(
          2,
          "0",
        )}${parts.hour.padStart(2, "0")}`,
      ),
    };
  }

  if (bucket === "day") {
    const parts = dateParts(date, timeZone);
    return {
      key: `${parts.year}-${parts.month}-${parts.day}`,
      label: `${parts.month}/${parts.day}`,
      sortValue: Number(
        `${parts.year}${parts.month.padStart(2, "0")}${parts.day.padStart(
          2,
          "0",
        )}`,
      ),
    };
  }

  const parts = dateParts(date, timeZone);
  return {
    key: `${parts.year}-${parts.month}`,
    label: `${parts.month}/${parts.year}`,
    sortValue: Number(`${parts.year}${parts.month.padStart(2, "0")}`),
  };
}

function dateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
  };
}

function formatHour(hour: number) {
  if (hour === 0) {
    return "12 AM";
  }

  if (hour < 12) {
    return `${hour} AM`;
  }

  if (hour === 12) {
    return "12 PM";
  }

  return `${hour - 12} PM`;
}
