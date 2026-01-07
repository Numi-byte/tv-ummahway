"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import QRCode from "react-qr-code";

type Masjid = {
  id: string;
  official_name: string;
  city: string | null;
  timezone: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

type PrayerRow = {
  prayer: PrayerKey;
  start_time: string;
  jamaat_time: string;
  date: string;
};

type AnnouncementRow = {
  id: number;
  title: string;
  body: string;
  category: string;
  is_pinned: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

type JumuahRow = {
  id: number;
  slot: number;
  khutbah_time: string;
  jamaat_time: string;
  language: string | null;
  notes: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

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

type HadithOut = {
  collection: string;
  edition: string;
  hadithnumber: number;
  text: string;
  grade?: string | null;
  reference?: { book?: number; hadith?: number };
};

type SlideKey = "board" | "jumuah" | "announcements";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.ummahway.app";

const PRAYER_ORDER: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const PRAYER_LABEL: Record<PrayerKey, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

function two(n: number) {
  return String(n).padStart(2, "0");
}
function formatTimeHHMM(time?: string | null) {
  return time ? time.slice(0, 5) : "—";
}
function timeToMinutes(t?: string | null) {
  if (!t) return null;
  const [hh, mm] = t.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}
function nowInTimeZone(tz: string | null) {
  const timeZone = tz || "Europe/Rome";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const weekday = get("weekday");
  return { year, month, day, hour, minute, second, weekday, timeZone };
}
function ymdFromClock(c: ReturnType<typeof nowInTimeZone>) {
  return `${c.year}-${two(c.month)}-${two(c.day)}`;
}
function computeNextPrayer(prayers: PrayerRow[], tz: string | null) {
  const n = nowInTimeZone(tz);
  const today = ymdFromClock(n);
  const minutesNow = n.hour * 60 + n.minute;
  const todayRows = prayers.filter((p) => p.date === today);

  for (const key of PRAYER_ORDER) {
    const row = todayRows.find((r) => r.prayer === key);
    if (!row) continue;
    const mins = timeToMinutes(row.jamaat_time);
    if (mins == null) continue;
    if (mins >= minutesNow) return { prayer: key, mins };
  }

  const first = todayRows.find((r) => r.prayer === "fajr") ?? null;
  if (first) {
    const mins = timeToMinutes(first.jamaat_time);
    if (mins != null) return { prayer: "fajr" as PrayerKey, mins };
  }
  return null;
}
function computeNextJumuah(jumuah: JumuahRow[], tz: string | null) {
  const n = nowInTimeZone(tz);
  const minutesNow = n.hour * 60 + n.minute;
  for (const row of jumuah) {
    const mins = timeToMinutes(row.khutbah_time);
    if (mins == null) continue;
    if (mins >= minutesNow) return { row, mins };
  }
  return null;
}
function msUntilNextSecond() {
  const now = new Date();
  return 1000 - now.getMilliseconds();
}

/** Fullscreen helpers */
function canFullscreen() {
  return (
    typeof document !== "undefined" && !!document.documentElement.requestFullscreen
  );
}
async function enterFullscreen() {
  try {
    if (!canFullscreen()) return;
    if (document.fullscreenElement) return;
    await document.documentElement.requestFullscreen();
  } catch {}
}
async function exitFullscreen() {
  try {
    if (!document.fullscreenElement) return;
    await document.exitFullscreen();
  } catch {}
}

function wxEmoji(code?: number | null) {
  if (code == null) return "⛅";
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
  if ([71, 73, 75, 77].includes(code)) return "🌨️";
  if ([80, 81, 82].includes(code)) return "🌧️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "⛅";
}

export default function TVClient() {
  const sp = useSearchParams();

  const masjidId = sp.get("masjid");
  const cycleSec = Math.max(8, Number(sp.get("cycle") ?? 14));
  const tzOverride = sp.get("tz");

  const alive = useRef(true);

  const [masjid, setMasjid] = useState<Masjid | null>(null);
  const [prayers, setPrayers] = useState<PrayerRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [jumuahTimes, setJumuahTimes] = useState<JumuahRow[]>([]);
  const [weather, setWeather] = useState<WeatherOut | null>(null);
  const [hadith, setHadith] = useState<HadithOut | null>(null);

  const [bootError, setBootError] = useState<string | null>(null);

  const [clock, setClock] = useState(() => nowInTimeZone("Europe/Rome"));
  const tz = tzOverride || masjid?.timezone || "Europe/Rome";
  const todayKey = useMemo(() => ymdFromClock(clock), [clock]);

  const isFriday = clock.weekday === "Fri";

  const [slide, setSlide] = useState<SlideKey>("board");
  const [slideProgress, setSlideProgress] = useState(0);

  const [fullscreenPrompt, setFullscreenPrompt] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ✅ HARD LOCK PAGE SCROLL (TV: never scroll)
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevHtmlH = document.documentElement.style.height;
    const prevBodyH = document.body.style.height;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";

    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.documentElement.style.height = prevHtmlH;
      document.body.style.height = prevBodyH;
    };
  }, []);

  // Track fullscreen state
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    onFs();
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Global key handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key.toLowerCase() === "f") {
        enterFullscreen().then(() => setFullscreenPrompt(false));
      }
      if (e.key === "Escape") exitFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Smooth clock in masjid timezone
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setClock(nowInTimeZone(tz));
      timer = setTimeout(tick, msUntilNextSecond());
    };
    timer = setTimeout(tick, msUntilNextSecond());
    return () => clearTimeout(timer);
  }, [tz]);

  // auto-reduce counts on smaller TVs (guarantee no overflow)
  const [maxAnnFull, setMaxAnnFull] = useState(6);
  const [maxAnnPreview, setMaxAnnPreview] = useState(3);
  useEffect(() => {
    const calc = () => {
      const h = window.innerHeight;
      // safe defaults for 720p / small displays
      setMaxAnnFull(h < 820 ? 4 : 6);
      setMaxAnnPreview(h < 820 ? 2 : 3);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  function filterActiveByDate<T extends { valid_from: string | null; valid_to: string | null }>(
    rows: T[],
    ymd: string
  ) {
    return rows.filter((r) => {
      const fromOk = !r.valid_from || r.valid_from <= ymd;
      const toOk = !r.valid_to || r.valid_to >= ymd;
      return fromOk && toOk;
    });
  }

  async function loadAll(mId: string) {
    const { data: m, error: mErr } = await supabase
      .from("public_masjids")
      .select("id, official_name, city, timezone, latitude, longitude")
      .eq("id", mId)
      .maybeSingle();

    if (mErr || !m) throw new Error("Masjid not found or not public.");
    if (!alive.current) return;

    const masjidObj = m as Masjid;
    setMasjid(masjidObj);

    const today = todayKey;

    const { data: p } = await supabase
      .from("masjid_prayer_times")
      .select("prayer, start_time, jamaat_time, date")
      .eq("masjid_id", mId)
      .eq("date", today);

    if (!alive.current) return;
    setPrayers((p ?? []) as PrayerRow[]);

    const { data: a } = await supabase
      .from("masjid_announcements")
      .select("id, title, body, category, is_pinned, starts_at, ends_at, created_at")
      .eq("masjid_id", mId)
      .or("starts_at.is.null,starts_at.lte.now()")
      .or("ends_at.is.null,ends_at.gte.now()")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (!alive.current) return;
    setAnnouncements((a ?? []) as AnnouncementRow[]);

    // ✅ Jumu'ah timings always loaded (independent from Friday)
    const { data: jt } = await supabase
      .from("masjid_jumuah_times")
      .select("id, slot, khutbah_time, jamaat_time, language, notes, valid_from, valid_to")
      .eq("masjid_id", mId)
      .order("slot", { ascending: true })
      .limit(10);

    if (!alive.current) return;
    // show current active schedule based on date range
    setJumuahTimes(filterActiveByDate((jt ?? []) as JumuahRow[], today));

    // Weather
    if (masjidObj.city || (masjidObj.latitude != null && masjidObj.longitude != null)) {
      const qs = new URLSearchParams();
      if (masjidObj.city) qs.set("city", masjidObj.city);
      qs.set("tz", tz);
      if (masjidObj.latitude != null) qs.set("lat", String(masjidObj.latitude));
      if (masjidObj.longitude != null) qs.set("lon", String(masjidObj.longitude));

      fetch(`/api/weather?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive.current && j && setWeather(j))
        .catch(() => {});
    }

    // Hadith
    {
      const qs = new URLSearchParams();
      qs.set("edition", "eng-bukhari");
      qs.set("seed", `${today}:${mId}`);
      fetch(`/api/hadith?${qs.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive.current && j && setHadith(j))
        .catch(() => {});
    }
  }

  // Boot + reload when day changes
  useEffect(() => {
    alive.current = true;
    setBootError(null);

    if (!masjidId) {
      setBootError("Missing masjid id. Use: ?masjid=<UUID>");
      return () => {
        alive.current = false;
      };
    }

    (async () => {
      try {
        await loadAll(masjidId);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Could not load TV data.";
        setBootError(message);
      }
    })();

    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masjidId, todayKey]);

  // Realtime refresh
  useEffect(() => {
    if (!masjidId) return;

    const channel = supabase
      .channel(`tv:${masjidId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "masjid_prayer_times", filter: `masjid_id=eq.${masjidId}` },
        async () => { try { await loadAll(masjidId); } catch {} }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "masjid_announcements", filter: `masjid_id=eq.${masjidId}` },
        async () => { try { await loadAll(masjidId); } catch {} }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "masjid_jumuah_times", filter: `masjid_id=eq.${masjidId}` },
        async () => { try { await loadAll(masjidId); } catch {} }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masjidId, todayKey]);

  const activeJumuah = useMemo(
    () => jumuahTimes.slice().sort((a, b) => a.slot - b.slot).slice(0, 3), // ✅ max 3 slots
    [jumuahTimes]
  );

  // Slideshow: Jumu'ah slide only on Friday (concept), but timings always visible in header
  useEffect(() => {
    const slides: SlideKey[] = ["board"];
    if (isFriday && activeJumuah.length > 0) slides.push("jumuah");
    if (announcements.length > 0) slides.push("announcements");

    let i = 0;
    setSlide(slides[0]);
    setSlideProgress(0);

    const start = Date.now();

    const progressTimer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const prog = (elapsed % cycleSec) / cycleSec;
      setSlideProgress(prog);
    }, 120);

    const timer = setInterval(() => {
      i = (i + 1) % slides.length;
      setSlide(slides[i]);
    }, cycleSec * 1000);

    return () => {
      clearInterval(timer);
      clearInterval(progressTimer);
    };
  }, [cycleSec, announcements.length, isFriday, activeJumuah.length]);

  const next = useMemo(() => computeNextPrayer(prayers, tz), [prayers, tz]);
  const nextLabel = next ? PRAYER_LABEL[next.prayer] : "—";

  const countdown = useMemo(() => {
    if (!next) return "—";
    const n = nowInTimeZone(tz);
    const nowM = n.hour * 60 + n.minute;
    let diff = next.mins - nowM;
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${m}m`;
  }, [next, clock, tz]);

  const nextJ = useMemo(
    () => (isFriday ? computeNextJumuah(activeJumuah, tz) : null),
    [activeJumuah, isFriday, tz]
  );

  const jumuahCountdown = useMemo(() => {
    if (!isFriday || !nextJ) return null;
    const n = nowInTimeZone(tz);
    const nowM = n.hour * 60 + n.minute;
    let diff = nextJ.mins - nowM;
    if (diff < 0) diff = 0;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${m}m`;
  }, [nextJ, isFriday, clock, tz]);

  // UI states
  if (bootError) {
    return (
      <div className="fixed inset-0 h-[100dvh] w-[100vw] overflow-hidden noor-bg text-white">
        <div className="noise" />
        <div className="mx-auto flex h-full max-w-5xl items-center justify-center p-8">
          <div className="glass w-full rounded-3xl p-10">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay TV</div>
            <div className="mt-4 text-3xl font-black">Could not load display</div>
            <div className="mt-4 text-white/70">{bootError}</div>
            <div className="mt-6 text-sm text-white/40">
              Example URL: <span className="font-mono">/tv?masjid=&lt;UUID&gt;</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!masjid) {
    return (
      <div className="fixed inset-0 h-[100dvh] w-[100vw] overflow-hidden noor-bg text-white">
        <div className="noise" />
        <div className="mx-auto flex h-full max-w-5xl items-center justify-center p-8">
          <div className="glass w-full rounded-3xl p-10">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay TV</div>
            <div className="mt-4 text-3xl font-black">Loading…</div>
            <div className="mt-2 text-white/60">Connecting to masjid feed</div>
          </div>
        </div>
      </div>
    );
  }

  const title = masjid.official_name;
  const place = masjid.city ? `${masjid.city}` : "";

  return (
    <div
      className="fixed inset-0 h-[100dvh] w-[100vw] overflow-hidden text-white"
      onClick={() => {
        if (!isFullscreen) enterFullscreen().then(() => setFullscreenPrompt(false));
        else setFullscreenPrompt(false);
      }}
    >
      <div className="absolute inset-0 noor-bg" />
      <div className="noise" />

      {/* Top-right fullscreen button */}
      <div className="absolute right-4 top-4 z-20">
        <button
          className="glass rounded-2xl px-5 py-3 text-lg font-extrabold text-white/90 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            if (isFullscreen) exitFullscreen();
            else enterFullscreen().then(() => setFullscreenPrompt(false));
          }}
        >
          {isFullscreen ? "⤢ Exit" : "⛶ Fullscreen"}
        </button>
      </div>

      {/* Fullscreen prompt overlay */}
      {fullscreenPrompt && !isFullscreen && (
        <div className="absolute inset-0 z-30 overflow-hidden flex items-center justify-center bg-black/55 p-6">
          <div className="glass w-full max-w-4xl rounded-3xl p-10 text-center">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay TV</div>
            <div className="mt-5 text-4xl md:text-5xl font-black">Press OK to go Fullscreen</div>
            <div className="mt-4 text-lg md:text-xl text-white/70">
              Click / press Enter once. After that, the display runs hands-free.
            </div>
            <div className="mt-8 text-sm text-white/40">Tip: On most remotes, OK = click.</div>
            <div className="mt-10">
              <button
                className="rounded-2xl bg-emerald-400 px-8 py-4 text-xl font-black text-emerald-950"
                onClick={(e) => {
                  e.stopPropagation();
                  enterFullscreen().then(() => setFullscreenPrompt(false));
                }}
              >
                Enter Fullscreen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide progress */}
      <div className="absolute left-0 top-0 z-10 h-1 w-full bg-white/10">
        <div
          className="h-full bg-emerald-400 transition-[width]"
          style={{ width: `${Math.round(slideProgress * 100)}%` }}
        />
      </div>

      {/* Main shell */}
      <div className="relative z-10 flex h-full w-full flex-col p-3 md:p-5">
        {/* Header (never grows) */}
        <div className="shrink-0 grid grid-cols-1 xl:grid-cols-12 gap-3 md:gap-5">
          <div className="glass rounded-3xl px-5 py-4 xl:col-span-8 overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.35em] text-white/60">
                  Prayer Times • Jamaat • Weather • Hadith
                </div>
                <div className="mt-2 text-[clamp(1.8rem,3.2vw,3.2rem)] font-black leading-tight truncate">
                  {title}
                </div>
                {place && (
                  <div className="mt-1 text-lg md:text-xl text-white/70 truncate">
                    {place}
                  </div>
                )}
              </div>

              <div className="hidden md:flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs uppercase tracking-[0.35em] text-white/50">UmmahWay</div>
                  <div className="text-sm text-white/70">Scan to install</div>
                </div>
                <div className="rounded-2xl bg-white p-2">
                  <QRCode value={PLAY_STORE_URL} size={58} />
                </div>
              </div>
            </div>
          </div>

          <div className="glass rounded-3xl px-5 py-4 xl:col-span-4 overflow-hidden">
            <div className="text-sm uppercase tracking-[0.32em] text-white/60">
              {clock.weekday} • {two(clock.day)}/{two(clock.month)}/{clock.year}
            </div>

            <div className="tick mt-2 text-[clamp(2rem,3.6vw,3.6rem)] font-black">
              {two(clock.hour)}:{two(clock.minute)}
              <span className="text-white/40">:{two(clock.second)}</span>
            </div>

            <div className="mt-1 text-base md:text-lg text-white/70">
              Next: <span className="font-black text-white">{nextLabel}</span>{" "}
              <span className="text-white/50">in</span>{" "}
              <span className="font-black text-emerald-300">{countdown}</span>
            </div>

            {/* ✅ Jumu'ah timings ALWAYS shown (up to 3 slots) */}
            {activeJumuah.length > 0 && (
              <div className="mt-2">
                <div className="text-xs uppercase tracking-[0.32em] text-white/50">
                  Jumu’ah (Fri) • All Jamaats
                </div>

                {/* small chips that cannot overflow height */}
                <div className="mt-2 flex flex-wrap gap-2 overflow-hidden">
                  {activeJumuah.map((j) => (
                    <div
                      key={j.id}
                      className="max-w-full rounded-full bg-white/5 px-3 py-1 text-sm font-black text-white/85"
                    >
                      <span className="text-white/60">#{j.slot}</span>{" "}
                      {formatTimeHHMM(j.khutbah_time)}→{formatTimeHHMM(j.jamaat_time)}
                      {j.language ? <span className="text-white/50"> • {j.language}</span> : null}
                    </div>
                  ))}
                </div>

                {/* only on Friday show next countdown */}
                {isFriday && nextJ?.row && jumuahCountdown && (
                  <div className="mt-1 text-sm text-white/65">
                    Next khutbah:{" "}
                    <span className="font-black text-white">
                      {formatTimeHHMM(nextJ.row.khutbah_time)}
                    </span>{" "}
                    <span className="text-white/50">in</span>{" "}
                    <span className="font-black text-emerald-300">{jumuahCountdown}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Slides (must be shrinkable) */}
        <div className="mt-3 md:mt-4 flex-1 min-h-0 overflow-hidden">
          {slide === "board" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 md:gap-5 h-full min-h-0 overflow-hidden">
              {/* Prayer panel */}
              <div className="glass rounded-3xl p-5 xl:col-span-7 min-h-0 overflow-hidden">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.35em] text-white/60">Today</div>
                    <div className="mt-1 text-2xl md:text-3xl font-black">Prayer Schedule</div>
                  </div>
                  <div className="text-sm md:text-base text-white/60">
                    Local <span className="font-black text-white/80">{tz}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-white/85">
                  <div className="text-sm font-extrabold text-white/55 uppercase tracking-widest">
                    Prayer
                  </div>
                  <div className="text-sm font-extrabold text-white/55 uppercase tracking-widest text-center">
                    Start
                  </div>
                  <div className="text-sm font-extrabold text-white/55 uppercase tracking-widest text-right">
                    Jamaat
                  </div>

                  {PRAYER_ORDER.map((k) => {
                    const row = prayers.find((p) => p.prayer === k);
                    const isNext = next?.prayer === k;

                    const cell = (extra: string) =>
                      [
                        "rounded-2xl px-4 py-4 font-black overflow-hidden",
                        isNext ? "bg-emerald-400 text-emerald-950" : "bg-white/5",
                        extra,
                      ].join(" ");

                    return (
                      <React.Fragment key={k}>
                        <div className={cell("text-xl md:text-2xl truncate")}>
                          {PRAYER_LABEL[k]}
                        </div>
                        <div className={cell("tick text-center text-xl md:text-2xl")}>
                          {row ? formatTimeHHMM(row.start_time) : "—"}
                        </div>
                        <div className={cell("tick text-right text-xl md:text-2xl")}>
                          {row ? formatTimeHHMM(row.jamaat_time) : "—"}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                <div className="mt-4 text-xs md:text-sm text-white/45">
                  Updates instantly from admin — TVs refresh automatically.
                </div>
              </div>

              {/* Right column: Weather + Hadith + Announcements (no overflow) */}
              <div className="xl:col-span-5 grid min-h-0 grid-rows-[auto,auto,1fr] gap-3 md:gap-5 overflow-hidden">
                {/* Weather */}
                <div className="glass rounded-3xl p-5 overflow-hidden">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.35em] text-white/60">Weather</div>
                      <div className="mt-1 text-2xl font-black">Outlook</div>
                    </div>
                    <div className="text-sm text-white/60 truncate max-w-[55%]">
                      {weather?.location?.name ?? (masjid.city || "—")}
                    </div>
                  </div>

                  {!weather ? (
                    <div className="mt-3 rounded-2xl bg-white/5 p-4 text-white/60">Loading…</div>
                  ) : (
                    <>
                      <div className="mt-3 flex items-center justify-between rounded-2xl bg-white/5 p-4">
                        <div className="text-base text-white/75">Now</div>
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{wxEmoji(weather.current?.weathercode ?? null)}</div>
                          <div className="text-2xl font-black">
                            {weather.current?.temperature != null
                              ? `${Math.round(weather.current.temperature)}°C`
                              : "—"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-3">
                        {weather.daily.slice(0, 3).map((d) => (
                          <div key={d.date} className="rounded-2xl bg-white/5 p-3 text-center overflow-hidden">
                            <div className="text-xs text-white/60">{d.date.slice(5)}</div>
                            <div className="mt-1 text-2xl">{wxEmoji(d.weathercode ?? null)}</div>
                            <div className="mt-1 text-base font-black">
                              {d.tmax != null ? Math.round(d.tmax) : "—"}°
                              <span className="text-white/40"> / </span>
                              {d.tmin != null ? Math.round(d.tmin) : "—"}°
                            </div>
                            <div className="mt-1 text-xs text-white/60">
                              {d.precipProbMax != null ? `${Math.round(d.precipProbMax)}%` : "—"} rain
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Hadith */}
                <div className="glass rounded-3xl p-5 overflow-hidden">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.35em] text-white/60">Hadith</div>
                      <div className="mt-1 text-2xl font-black">Daily Reminder</div>
                    </div>
                    <div className="text-sm text-white/60 truncate max-w-[45%]">
                      {hadith?.collection ?? "—"}
                    </div>
                  </div>

                  {!hadith ? (
                    <div className="mt-3 rounded-2xl bg-white/5 p-4 text-white/60">Loading…</div>
                  ) : (
                    <>
                      <div className="mt-3 rounded-2xl bg-white/5 p-4 text-base leading-6 text-white/80 line-clamp-4">
                        <span className="text-emerald-300 font-black">“</span>
                        {hadith.text}
                        <span className="text-emerald-300 font-black">”</span>
                      </div>
                      <div className="mt-2 text-xs text-white/50 truncate">
                        #{hadith.hadithnumber}
                        {hadith.grade ? ` • Grade: ${hadith.grade}` : ""}
                      </div>
                    </>
                  )}
                </div>

                {/* Announcements preview (fills remainder, no overflow) */}
                <div className="glass rounded-3xl p-5 min-h-0 overflow-hidden">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.35em] text-white/60">Now</div>
                      <div className="mt-1 text-2xl font-black">Announcements</div>
                    </div>
                    <div className="text-sm text-white/60">{announcements.length}</div>
                  </div>

                  <div className="mt-3 space-y-3 min-h-0 overflow-hidden">
                    {announcements.slice(0, maxAnnPreview).map((a) => (
                      <div key={a.id} className="rounded-3xl border border-white/10 bg-white/5 p-4 overflow-hidden">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-lg font-black leading-tight line-clamp-1">
                            {a.title}
                          </div>
                          {a.is_pinned && (
                            <div className="rounded-full bg-amber-300/20 px-3 py-1 text-[11px] font-black text-amber-200 shrink-0">
                              PINNED
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-sm leading-5 text-white/70 line-clamp-2">
                          {a.body}
                        </div>
                      </div>
                    ))}

                    {announcements.length === 0 && (
                      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-white/60">
                        No announcements right now.
                      </div>
                    )}
                  </div>

                  <div className="mt-3 text-xs text-white/45">
                    Full list rotates on the announcements slide.
                  </div>
                </div>
              </div>
            </div>
          )}

          {slide === "jumuah" && (
            <div className="glass w-full h-full rounded-3xl p-6 md:p-8 overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.35em] text-white/60">Friday Special</div>
                  <div className="mt-2 text-[clamp(2rem,3.6vw,3.6rem)] font-black truncate">
                    Jumu’ah Mubarak ✨
                  </div>
                  <div className="mt-2 text-lg text-white/70 line-clamp-2">
                    {nextJ?.row
                      ? `Next khutbah at ${formatTimeHHMM(nextJ.row.khutbah_time)} (in ${jumuahCountdown})`
                      : "May Allah accept your Jumu’ah."}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="rounded-3xl bg-white p-3">
                    <QRCode value={PLAY_STORE_URL} size={98} />
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay</div>
                    <div className="text-lg font-black">Get the app</div>
                    <div className="text-white/60">Scan on Android</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 xl:grid-cols-12 gap-5 min-h-0 overflow-hidden">
                <div className="xl:col-span-7 min-h-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.35em] text-white/60">Jumu’ah Timings</div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {activeJumuah.map((j) => (
                      <div key={j.id} className="rounded-3xl border border-white/10 bg-white/5 p-5 overflow-hidden">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xl font-black truncate">Slot {j.slot}</div>
                          {j.language && (
                            <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-200 shrink-0">
                              {j.language}
                            </div>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="rounded-2xl bg-white/5 p-3">
                            <div className="text-xs text-white/60">Khutbah</div>
                            <div className="tick mt-1 text-2xl font-black">
                              {formatTimeHHMM(j.khutbah_time)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white/5 p-3">
                            <div className="text-xs text-white/60">Jamaat</div>
                            <div className="tick mt-1 text-2xl font-black">
                              {formatTimeHHMM(j.jamaat_time)}
                            </div>
                          </div>
                        </div>
                        {j.notes && <div className="mt-2 text-sm text-white/70 line-clamp-2">{j.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="xl:col-span-5 min-h-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.35em] text-white/60">Friday Checklist</div>
                  <div className="mt-4 rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-6 overflow-hidden">
                    <div className="text-xl font-black">Make Friday feel special</div>
                    <div className="mt-3 text-base text-white/75 leading-6 line-clamp-6">
                      • Ghusl & best clothes<br />
                      • Early to the masjid<br />
                      • Abundant salawat<br />
                      • Surah Al-Kahf (if you follow that opinion)<br />
                      • Dua in the last hour
                    </div>
                    {hadith && (
                      <div className="mt-4 rounded-2xl bg-white/10 p-4 overflow-hidden">
                        <div className="text-xs uppercase tracking-[0.35em] text-white/60">Today’s Hadith</div>
                        <div className="mt-2 text-base text-white/80 leading-6 line-clamp-4">
                          <span className="text-emerald-300 font-black">“</span>
                          {hadith.text}
                          <span className="text-emerald-300 font-black">”</span>
                        </div>
                        <div className="mt-2 text-xs text-white/55 truncate">
                          {hadith.collection} • #{hadith.hadithnumber}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {slide === "announcements" && (
            <div className="glass w-full h-full rounded-3xl p-6 md:p-8 overflow-hidden">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.35em] text-white/60">Important</div>
                  <div className="mt-2 text-3xl md:text-4xl font-black truncate">Announcements</div>
                </div>
                <div className="hidden md:block rounded-3xl bg-white p-3 shrink-0">
                  <QRCode value={PLAY_STORE_URL} size={84} />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-0 overflow-hidden">
                {announcements.slice(0, maxAnnFull).map((a) => (
                  <div
                    key={a.id}
                    className={[
                      "rounded-3xl border p-6 overflow-hidden",
                      a.is_pinned
                        ? "border-amber-300/30 bg-amber-200/10"
                        : "border-white/10 bg-white/5",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-2xl font-black leading-tight line-clamp-1">{a.title}</div>
                      {a.is_pinned && (
                        <div className="rounded-full bg-amber-300/20 px-3 py-1 text-xs font-black text-amber-200 shrink-0">
                          PINNED
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-base md:text-lg leading-6 md:leading-7 text-white/75 line-clamp-4">
                      {a.body}
                    </div>
                  </div>
                ))}

                {announcements.length === 0 && (
                  <div className="col-span-2 rounded-3xl border border-white/10 bg-white/5 p-8 text-xl text-white/60">
                    No announcements right now.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom ticker (never grows) */}
        <div className="shrink-0 mt-3 glass rounded-3xl px-6 py-4 overflow-hidden">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-black text-emerald-950 shrink-0">
              LIVE
            </div>

            <div className="marquee flex-1 text-lg text-white/80 overflow-hidden">
              <div className="truncate">
                {announcements.length
                  ? announcements.map((a) => `• ${a.title}`).join("   ")
                  : "• Welcome • Prayer times update automatically • Scan QR to install UmmahWay •"}
              </div>
            </div>

            <div className="hidden sm:block rounded-2xl bg-white p-2 shrink-0">
              <QRCode value={PLAY_STORE_URL} size={50} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
