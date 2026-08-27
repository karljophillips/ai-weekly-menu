export interface DailyForecast {
  date: string; // YYYY-MM-DD
  tempMaxC: number;
  tempMinC: number;
  precipitationProbability: number;
  weatherCode: number; // WMO weather interpretation code
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
  hourly: {
    time: string[];
    weather_code: number[];
  };
}

const DAYTIME_START_HOUR = 8;
const DAYTIME_END_HOUR = 18;

/**
 * Open-Meteo's `daily.weather_code` is the single most severe condition of
 * the day, so a mostly-clear day with one brief overcast spell reads as
 * "overcast." The most common code across daytime hours is a better match
 * for what the day actually looked like.
 */
function representativeDaytimeCode(
  hourlyTimes: string[],
  hourlyCodes: number[],
  date: string
): number {
  const counts = new Map<number, number>();
  let fallback: number | undefined;

  hourlyTimes.forEach((time, i) => {
    if (!time.startsWith(date)) return;
    const hour = Number(time.slice(11, 13));
    const code = hourlyCodes[i];
    fallback ??= code;
    if (hour >= DAYTIME_START_HOUR && hour <= DAYTIME_END_HOUR) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  });

  let best = fallback ?? 0;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 7-day forecast for the week starting `startDate` (YYYY-MM-DD), for the
 * location in LOCATION_LAT/LOCATION_LON. Uses an explicit date range rather
 * than "next 7 days" since generation runs the night before the target week
 * starts, not on the first day of it. `timezone` (an IANA name, e.g.
 * "America/New_York") is the household's own timezone (Settings.Timezone) —
 * it's what Open-Meteo uses to bucket `daily`/`hourly` values by calendar day.
 */
export async function getWeeklyForecast(
  startDate: string,
  timezone: string
): Promise<DailyForecast[]> {
  const lat = process.env.LOCATION_LAT;
  const lon = process.env.LOCATION_LON;
  if (!lat || !lon) {
    throw new Error("Missing LOCATION_LAT or LOCATION_LON");
  }

  const endDate = new Date(`${startDate}T00:00:00`);
  endDate.setDate(endDate.getDate() + 6);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=weather_code` +
    `&timezone=${encodeURIComponent(timezone)}&start_date=${startDate}&end_date=${endDate.toISOString().slice(0, 10)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }

  const data = (await res.json()) as OpenMeteoResponse;

  return data.daily.time.map((date, i) => ({
    date,
    tempMaxC: data.daily.temperature_2m_max[i],
    tempMinC: data.daily.temperature_2m_min[i],
    precipitationProbability: data.daily.precipitation_probability_max[i],
    weatherCode: representativeDaytimeCode(
      data.hourly.time,
      data.hourly.weather_code,
      date
    ),
  }));
}

/** Emoji for a WMO weather interpretation code (https://open-meteo.com/en/docs). */
export function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code === 51 || code === 53 || code === 55) return "🌦️";
  if (code === 56 || code === 57) return "🌧️";
  if (code === 61 || code === 63 || code === 65) return "🌧️";
  if (code === 66 || code === 67) return "🌧️";
  if (code === 71 || code === 73 || code === 75 || code === 77) return "🌨️";
  if (code === 80 || code === 81 || code === 82) return "🌦️";
  if (code === 85 || code === 86) return "🌨️";
  if (code === 95 || code === 96 || code === 99) return "⛈️";
  return "";
}
