export interface DailyForecast {
  date: string; // YYYY-MM-DD
  tempMaxC: number;
  tempMinC: number;
  precipitationProbability: number;
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

/**
 * 7-day forecast for the week starting `startDate` (YYYY-MM-DD), for the
 * location in LOCATION_LAT/LOCATION_LON. Uses an explicit date range rather
 * than "next 7 days" since generation runs the night before the target week
 * starts, not on the first day of it.
 */
export async function getWeeklyForecast(
  startDate: string
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
    `&timezone=America%2FNew_York&start_date=${startDate}&end_date=${endDate.toISOString().slice(0, 10)}`;

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
  }));
}
