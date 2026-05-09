import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  readings: defineTable({
    deviceId: v.string(),
    recordedAt: v.number(),
    tempC: v.number(),
    humidityPct: v.number(),
    co2Ppm: v.number(),
  }).index("by_device_time", ["deviceId", "recordedAt"]),
  devices: defineTable({
    deviceId: v.string(),
    name: v.string(),
    location: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_device_id", ["deviceId"]),
});
