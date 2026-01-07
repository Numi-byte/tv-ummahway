// app/api/weather/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ok on Vercel too

type WeatherOut = {
  location: { name: string; latitude: number; longitude: number };
  current?: { temperature: number | null; weathercode: number | null };
  daily: Array<{
    date: string;
    tmax: number | null;
    tmin: number | null;
    precipProbMax: number | null;
    weathercode: number | null;
  }>;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const city = (searchParams.get("city") || "").trim();
  const tz = (searchParams.get("tz") || "Europe/Rome").trim();

  // Optional: if you later store coords in DB, you can pass them directly.
  const latQ = searchParams.get("lat");
  const lonQ = searchParams.get("lon");

  if (!city && (!latQ || !lonQ)) {
    return NextResponse.json(
      { error: "Missing city (or lat/lon)" },
      { status: 400 }
    );
  }

  let latitude: number | null = latQ ? Number(latQ) : null;
  let longitude: number | null = lonQ ? Number(lonQ) : null;
  let locName = city || "Unknown";

  // 1) Geocode city -> coords (only if lat/lon not provided)
  if (latitude == null || longitude == null) {
    const geoUrl =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(city)}` +
      `&count=1&language=en&format=json`;

    const geoRes = await fetch(geoUrl, {
      // Caching at the edge (works well for city lookups)
      headers: { "User-Agent": "UmmahWay/1.0 (TV Display)" },
    });

    if (!geoRes.ok) {
      return NextResponse.json(
        { error: "Geocoding failed" },
        { status: 502 }
      );
    }

    const geo = await geoRes.json();
    const first = geo?.results?.[0];

    latitude = num(first?.latitude);
    longitude = num(first?.longitude);
    locName =
      [first?.name, first?.admin1, first?.country].filter(Boolean).join(", ") ||
      city;

    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }
  }

  // 2) Forecast (daily outlook)
  const forecastUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(String(latitude))}` +
    `&longitude=${encodeURIComponent(String(longitude))}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&current_weather=true` +
    `&timezone=${encodeURIComponent(tz)}` +
    `&forecast_days=4`;

  const fRes = await fetch(forecastUrl, {
    headers: { "User-Agent": "UmmahWay/1.0 (TV Display)" },
  });

  if (!fRes.ok) {
    return NextResponse.json({ error: "Forecast failed" }, { status: 502 });
  }

  const f = await fRes.json();

  const dailyTimes: string[] = f?.daily?.time || [];
  const tmaxArr: (number | null)[] = f?.daily?.temperature_2m_max || [];
  const tminArr: (number | null)[] = f?.daily?.temperature_2m_min || [];
  const ppArr: (number | null)[] = f?.daily?.precipitation_probability_max || [];
  const wcArr: (number | null)[] = f?.daily?.weathercode || [];

  const out: WeatherOut = {
    location: { name: locName, latitude: latitude!, longitude: longitude! },
    current: {
      temperature: num(f?.current_weather?.temperature),
      weathercode: num(f?.current_weather?.weathercode),
    },
    daily: dailyTimes.map((date, i) => ({
      date,
      tmax: num(tmaxArr[i]),
      tmin: num(tminArr[i]),
      precipProbMax: num(ppArr[i]),
      weathercode: num(wcArr[i]),
    })),
  };

  return NextResponse.json(out, {
    headers: {
      // cache 15 min, allow stale while revalidate
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
    },
  });
}
