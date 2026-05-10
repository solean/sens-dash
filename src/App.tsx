import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Activity,
  Clock3,
  Droplets,
  Radio,
  Thermometer,
  Wind,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../convex/_generated/api";

const DEVICE_ID =
  (import.meta.env.VITE_DEFAULT_DEVICE_ID as string | undefined) ??
  "office-feather-01";
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAY = 24 * 60 * 60 * 1000;

const rangeOptions = [
  { id: "24h", label: "24h", duration: DAY, bucket: "hour" },
  { id: "7d", label: "7d", duration: 7 * DAY, bucket: "day" },
  { id: "30d", label: "30d", duration: 30 * DAY, bucket: "day" },
  { id: "1y", label: "1y", duration: 365 * DAY, bucket: "month" },
] as const;

type RangeId = (typeof rangeOptions)[number]["id"];
type TemperatureUnit = "F" | "C";
type ChartPoint = {
  label: string;
  count: number;
  tempAvg: number | null;
  humidityAvgPct: number | null;
  co2AvgPpm: number | null;
};
type MetricKey = "co2AvgPpm" | "tempAvg" | "humidityAvgPct";

type AppProps = {
  convexConfigured: boolean;
};

export default function App({ convexConfigured }: AppProps) {
  if (!convexConfigured) {
    return <SetupRequired />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const [now, setNow] = useState(() => Date.now());
  const [unit, setUnit] = useSearchParamState<TemperatureUnit>("unit", "F", [
    "F",
    "C",
  ]);
  const [rangeId, setRangeId] = useSearchParamState<RangeId>("range", "24h", [
    "24h",
    "7d",
    "30d",
    "1y",
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedRange =
    rangeOptions.find((option) => option.id === rangeId) ?? rangeOptions[0];
  const from = now - selectedRange.duration;
  const latest = useQuery(api.readings.latest, { deviceId: DEVICE_ID });
  const chartData = useQuery(api.readings.aggregate, {
    deviceId: DEVICE_ID,
    from,
    to: now,
    bucket: selectedRange.bucket,
    timeZone: TIME_ZONE,
  });
  const hourlyAverages = useQuery(api.readings.averageByHourOfDay, {
    deviceId: DEVICE_ID,
    from: now - 30 * DAY,
    to: now,
    timeZone: TIME_ZONE,
  });

  const normalizedChartData = useMemo(
    () =>
      chartData?.map((reading) => ({
        ...reading,
        tempAvg: convertTemp(reading.tempAvgC, unit),
      })),
    [chartData, unit],
  );
  const normalizedHourlyData = useMemo(
    () =>
      hourlyAverages?.map((reading) => ({
        ...reading,
        tempAvg:
          reading.tempAvgC === null ? null : convertTemp(reading.tempAvgC, unit),
      })),
    [hourlyAverages, unit],
  );

  const online = latest ? now - latest.recordedAt <= 15 * 60 * 1000 : false;

  return (
    <main id="main" className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indoor air monitor</p>
          <h1>Air Monitor</h1>
        </div>
        <div className="header-actions">
          <div className="device-pill" title={`Device ID: ${DEVICE_ID}`}>
            <Radio size={16} aria-hidden />
            <span>{DEVICE_ID}</span>
          </div>
          <SegmentedControl
            label="Temperature unit"
            value={unit}
            options={[
              { value: "F", label: "F" },
              { value: "C", label: "C" },
            ]}
            onChange={setUnit}
          />
        </div>
      </header>

      <section className="status-grid" aria-label="Current readings">
        <ReadingCard
          icon={<Wind size={22} aria-hidden />}
          label="CO2"
          value={latest ? numberFormat.format(Math.round(latest.co2Ppm)) : "—"}
          unit="ppm"
          status={latest ? co2Status(latest.co2Ppm) : "Waiting"}
          tone={latest ? co2Tone(latest.co2Ppm) : "neutral"}
        />
        <ReadingCard
          icon={<Thermometer size={22} aria-hidden />}
          label="Temperature"
          value={
            latest
              ? numberFormat.format(convertTemp(latest.tempC, unit, 1))
              : "—"
          }
          unit={`°${unit}`}
          status={latest ? tempStatus(convertTemp(latest.tempC, "F")) : "Waiting"}
          tone={latest ? tempTone(convertTemp(latest.tempC, "F")) : "neutral"}
        />
        <ReadingCard
          icon={<Droplets size={22} aria-hidden />}
          label="Humidity"
          value={
            latest ? numberFormat.format(roundTo(latest.humidityPct, 1)) : "—"
          }
          unit="%"
          status={latest ? humidityStatus(latest.humidityPct) : "Waiting"}
          tone={latest ? humidityTone(latest.humidityPct) : "neutral"}
        />
        <ReadingCard
          icon={<Clock3 size={22} aria-hidden />}
          label="Device"
          value={online ? "Online" : "Offline"}
          unit=""
          status={
            latest
              ? `Last update ${relativeTime(latest.recordedAt, now)}`
              : "No readings yet"
          }
          tone={online ? "good" : "bad"}
        />
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div>
            <h2>History</h2>
            <p>Average readings grouped by {selectedRange.bucket}.</p>
          </div>
          <SegmentedControl
            label="Time range"
            value={rangeId}
            options={rangeOptions.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            onChange={setRangeId}
          />
        </div>
        <MetricChartGroup
          data={normalizedChartData}
          unit={unit}
          emptyLabel="No readings in this range yet."
        />
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div>
            <h2>Patterns</h2>
            <p>Average readings by hour of day from the last 30 days.</p>
          </div>
          <div className="small-stat">
            <Activity size={16} aria-hidden />
            <span>5 min reporting</span>
          </div>
        </div>
        <MetricChartGroup
          data={normalizedHourlyData}
          unit={unit}
          emptyLabel="Hourly averages will appear after readings are received."
        />
      </section>
    </main>
  );
}

function ReadingCard({
  icon,
  label,
  value,
  unit,
  status,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  status: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <article className={`reading-card ${tone}`}>
      <div className="card-topline">
        <span className="card-icon">{icon}</span>
        <span className="status-chip">{status}</span>
      </div>
      <h2>{label}</h2>
      <p className="reading-value">
        <span>{value}</span>
        {unit ? <small>{unit}</small> : null}
      </p>
    </article>
  );
}

function MetricChartGroup({
  data,
  unit,
  emptyLabel,
}: {
  data: ChartPoint[] | undefined;
  unit: TemperatureUnit;
  emptyLabel: string;
}) {
  if (!data) {
    return <div className="chart-state">Loading…</div>;
  }

  if (data.length === 0 || data.every((point) => point.count === 0)) {
    return <div className="chart-state">{emptyLabel}</div>;
  }

  const metrics = getMetricConfigs(unit);

  return (
    <div className="metric-chart-list">
      {metrics.map((metric) => (
        <MetricChart key={metric.key} data={data} metric={metric} />
      ))}
    </div>
  );
}

function MetricChart({
  data,
  metric,
}: {
  data: ChartPoint[];
  metric: ReturnType<typeof getMetricConfigs>[number];
}) {
  return (
    <section className="metric-chart" aria-labelledby={`${metric.key}-title`}>
      <div className="metric-chart-header">
        <div>
          <h3 id={`${metric.key}-title`}>{metric.label}</h3>
          <p>{metric.description}</p>
        </div>
        <span className="metric-unit">{metric.unit}</span>
      </div>
      <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(211, 221, 214, 0.12)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: "#aab7af", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#aab7af", fontSize: 12 }}
            width={48}
            tickFormatter={(value) => metric.tickFormatter(Number(value))}
          />
          <Tooltip
            cursor={{ stroke: metric.cursorColor }}
            contentStyle={{
              background: "#121d19",
              border: "1px solid rgba(211, 221, 214, 0.16)",
              borderRadius: 8,
              color: "#edf5ef",
              boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
            }}
            formatter={(value) => metric.tooltipFormatter(value)}
            labelStyle={{ color: "#edf5ef" }}
          />
          <Line
            type="monotone"
            dataKey={metric.key}
            name={metric.label}
            stroke={metric.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
    </section>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "active" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SetupRequired() {
  return (
    <main id="main" className="setup-shell">
      <section className="setup-panel">
        <p className="eyebrow">Configuration needed</p>
        <h1>Connect Convex</h1>
        <p>
          Add <code>VITE_CONVEX_URL</code> to <code>.env.local</code> after
          creating the Convex deployment, then restart the dev server.
        </p>
      </section>
    </main>
  );
}

function useSearchParamState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
) {
  const [value, setValue] = useState<T>(() => {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get(key) as T | null;
    return candidate && allowed.includes(candidate) ? candidate : fallback;
  });

  const updateValue = (next: T) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, next);
    window.history.replaceState({}, "", url);
    setValue(next);
  };

  return [value, updateValue] as const;
}

function convertTemp(tempC: number, unit: TemperatureUnit, precision = 2) {
  const value = unit === "F" ? (tempC * 9) / 5 + 32 : tempC;
  return roundTo(value, precision);
}

function co2Tone(co2Ppm: number) {
  if (co2Ppm < 800) {
    return "good";
  }
  if (co2Ppm < 1200) {
    return "warn";
  }
  return "bad";
}

function co2Status(co2Ppm: number) {
  if (co2Ppm < 800) {
    return "Good";
  }
  if (co2Ppm < 1200) {
    return "Elevated";
  }
  return "High";
}

function tempTone(tempF: number) {
  if (tempF >= 68 && tempF <= 76) {
    return "good";
  }
  if (tempF >= 62 && tempF <= 82) {
    return "warn";
  }
  return "bad";
}

function tempStatus(tempF: number) {
  if (tempF >= 68 && tempF <= 76) {
    return "Comfort";
  }
  if (tempF < 68) {
    return "Cool";
  }
  if (tempF > 76 && tempF <= 82) {
    return "Warm";
  }
  return "Alert";
}

function humidityTone(humidityPct: number) {
  if (humidityPct >= 30 && humidityPct <= 60) {
    return "good";
  }
  if (humidityPct >= 20 && humidityPct <= 70) {
    return "warn";
  }
  return "bad";
}

function humidityStatus(humidityPct: number) {
  if (humidityPct >= 30 && humidityPct <= 60) {
    return "Comfort";
  }
  if (humidityPct < 30) {
    return "Dry";
  }
  if (humidityPct <= 70) {
    return "Humid";
  }
  return "Alert";
}

function relativeTime(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes === 1) {
    return "1 min ago";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function roundTo(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function getMetricConfigs(unit: TemperatureUnit): Array<{
  key: MetricKey;
  label: string;
  description: string;
  unit: string;
  color: string;
  cursorColor: string;
  tickFormatter: (value: number) => string;
  tooltipFormatter: (value: unknown) => [string, string];
}> {
  return [
    {
      key: "co2AvgPpm",
      label: "CO2",
      description: "Average carbon dioxide concentration.",
      unit: "ppm",
      color: "#eebc5a",
      cursorColor: "rgba(238, 188, 90, 0.35)",
      tickFormatter: (value) => numberFormat.format(Math.round(value)),
      tooltipFormatter: (value) => [
        typeof value === "number"
          ? `${numberFormat.format(Math.round(value))} ppm`
          : "—",
        "CO2",
      ],
    },
    {
      key: "tempAvg",
      label: "Temperature",
      description: "Average room temperature.",
      unit: `°${unit}`,
      color: "#6bb3ff",
      cursorColor: "rgba(107, 179, 255, 0.35)",
      tickFormatter: (value) => numberFormat.format(roundTo(value, 1)),
      tooltipFormatter: (value) => [
        typeof value === "number"
          ? `${numberFormat.format(roundTo(value, 1))} °${unit}`
          : "—",
        "Temperature",
      ],
    },
    {
      key: "humidityAvgPct",
      label: "Humidity",
      description: "Average relative humidity.",
      unit: "%",
      color: "#75d99a",
      cursorColor: "rgba(117, 217, 154, 0.35)",
      tickFormatter: (value) => numberFormat.format(roundTo(value, 1)),
      tooltipFormatter: (value) => [
        typeof value === "number"
          ? `${numberFormat.format(roundTo(value, 1))}%`
          : "—",
        "Humidity",
      ],
    },
  ];
}

const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
