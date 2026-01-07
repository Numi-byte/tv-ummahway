// app/api/hadith/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type HadithOut = {
  collection: string;
  edition: string;
  hadithnumber: number;
  text: string;
  grade?: string | null;
  reference?: { book?: number; hadith?: number };
};

function hashToInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

async function fetchJsonWithFallback(urls: string[]) {
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "UmmahWay/1.0 (TV Display)" },
      });
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status} for ${url}`);
        continue;
      }
      return await r.json();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("Hadith fetch failed");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Pick a default English edition (you can change anytime)
  const edition = (searchParams.get("edition") || "eng-bukhari").trim();
  const seed = (searchParams.get("seed") || new Date().toISOString().slice(0, 10)).trim();

  // We attempt up to 5 times to avoid “out of range” numbers without needing exact max counts.
  const base = hashToInt(`${edition}:${seed}`);
  const guesses = Array.from({ length: 5 }, (_, i) => ((base + i * 997) % 9000) + 1);

  let last: Error | null = null;

  for (const hadithNo of guesses) {
    const endpoint = `editions/${edition}/${hadithNo}.min.json`;

    const urls = [
      `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/${endpoint}`,
      `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${edition}/${hadithNo}.json`,
      // fallback suggested by maintainer
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/${endpoint}`,
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/${edition}/${hadithNo}.json`,
    ];

    try {
      const j = await fetchJsonWithFallback(urls);
      const metaName = j?.metadata?.name || "Hadith";
      const h = j?.hadiths?.[0];

      if (!h?.text) {
        last = new Error("Hadith payload missing text");
        continue;
      }

      const out: HadithOut = {
        collection: metaName,
        edition,
        hadithnumber: Number(h?.hadithnumber ?? hadithNo),
        text: String(h.text),
        grade: h?.grades?.[0]?.grade ?? null,
        reference: h?.reference ?? undefined,
      };

      return NextResponse.json(out, {
        headers: {
          // cache 6 hours (hadith-of-the-day stable anyway)
          "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=43200",
        },
      });
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
  }

  return NextResponse.json(
    { error: "Hadith fetch failed", detail: String(last?.message ?? last ?? "") },
    { status: 502 }
  );
}
