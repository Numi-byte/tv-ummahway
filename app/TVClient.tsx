"use client";

// AURORA - Minimal Cinematic TV Display
// Each slide is a full-screen experience with clean, focused content

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import QRCode from "react-qr-code";

/* =========================================================
   Types
   ========================================================= */
type Masjid = {
  id: string;
  official_name: string;
  short_name?: string | null;
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
  location: { name: string };
  current?: { temperature: number | null; weathercode: number | null };
  daily: Array<{
    date: string;
    tmax: number | null;
    tmin: number | null;
    weathercode: number | null;
  }>;
};
type HadithOut = {
  collection: string;
  hadithnumber: number;
  text: string;
  grade?: string | null;
};

type SlideType =
  | "welcome"
  | "clock"
  | "prayers"
  | "next-prayer"
  | "jumuah"
  | "announcement"
  | "weather"
  | "hadith"
  | "qr";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.ummahway.app";
// Use your real App Store URL here (this is the one you shared before)
const APPLE_STORE_URL =
  "https://apps.apple.com/it/app/ummahway/id6757399317?l=en-GB";

const PRAYER_ORDER: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const PRAYER_LABELS: Record<PrayerKey, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};
const PRAYER_ICONS: Record<PrayerKey, string> = {
  fajr: "🌅",
  dhuhr: "☀️",
  asr: "🌤️",
  maghrib: "🌅",
  isha: "🌙",
};

/* =========================================================
   Helpers
   ========================================================= */
const two = (n: number) => String(n).padStart(2, "0");
const formatTime = (t?: string | null) => (t ? t.slice(0, 5) : "—");
const timeToMins = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function nowInTz(tz: string | null) {
  const timeZone = tz || "Europe/Rome";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
    timeZone,
  };
}

const ymd = (c: ReturnType<typeof nowInTz>) =>
  `${c.year}-${two(c.month)}-${two(c.day)}`;

function getNextPrayer(prayers: PrayerRow[], tz: string | null) {
  const n = nowInTz(tz);
  const today = ymd(n);
  const nowM = n.hour * 60 + n.minute;
  const todayRows = prayers.filter((p) => p.date === today);
  for (const key of PRAYER_ORDER) {
    const row = todayRows.find((r) => r.prayer === key);
    if (!row) continue;
    const mins = timeToMins(row.jamaat_time);
    if (mins != null && mins >= nowM)
      return { key, row, mins, diff: mins - nowM };
  }
  return null;
}

function wxEmoji(code?: number | null) {
  if (code == null) return "⛅";
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if (
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
  )
    return "🌧️";
  if ([71, 73, 75, 77].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "⛅";
}

const formatCountdown = (mins: number) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/* =========================================================
   Fullscreen Helpers (cross-browser)
   ========================================================= */
function isFullscreenNow(): boolean {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return Boolean(
    document.fullscreenElement ||
      d.webkitFullscreenElement ||
      d.mozFullScreenElement ||
      d.msFullscreenElement
  );
}

async function requestFullscreenFor(el: HTMLElement) {
  const el_ = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
    mozRequestFullScreen?: () => Promise<void>;
    msRequestFullscreen?: () => Promise<void>;
  };
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el_.webkitRequestFullscreen) return el_.webkitRequestFullscreen();
  if (el_.mozRequestFullScreen) return el_.mozRequestFullScreen();
  if (el_.msRequestFullscreen) return el_.msRequestFullscreen();
}

async function exitFullscreen() {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    mozCancelFullScreen?: () => Promise<void>;
    msExitFullscreen?: () => Promise<void>;
  };
  if (document.exitFullscreen) return document.exitFullscreen();
  if (d.webkitExitFullscreen) return d.webkitExitFullscreen();
  if (d.mozCancelFullScreen) return d.mozCancelFullScreen();
  if (d.msExitFullscreen) return d.msExitFullscreen();
}

/* =========================================================
   Slide Components - Each is a full-screen minimal experience
   ========================================================= */

// Shared wrapper for all slides
const SlideWrapper: React.FC<{
  children: React.ReactNode;
  gradient?: string;
}> = ({ children, gradient }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center p-12 overflow-hidden">
    {gradient && <div className={`absolute inset-0 ${gradient} opacity-30`} />}
    <div className="relative z-10 w-full max-w-6xl">{children}</div>
  </div>
);

// 1. Welcome Slide
const WelcomeSlide: React.FC<{
  masjid: Masjid;
  clock: ReturnType<typeof nowInTz>;
}> = ({ masjid, clock }) => (
  <SlideWrapper gradient="bg-gradient-to-br from-emerald-900/50 via-transparent to-cyan-900/30">
    <div className="text-center">
      <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 mb-8">
        <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-lg text-white/70 uppercase tracking-[0.3em]">
          Live Display
        </span>
      </div>

      <h1 className="text-[clamp(3rem,8vw,8rem)] font-black leading-none text-white">
        {masjid.short_name || masjid.official_name}
      </h1>

      {masjid.city && (
        <p className="mt-6 text-[clamp(1.5rem,3vw,2.5rem)] text-white/50">
          {masjid.city}
        </p>
      )}

      <div className="mt-12 flex items-center justify-center gap-8">
        <div className="text-center">
          <div className="text-sm uppercase tracking-[0.3em] text-white/40 mb-2">
            {clock.weekday}
          </div>
          <div className="text-4xl font-bold text-white/80">
            {two(clock.day)}.{two(clock.month)}.{clock.year}
          </div>
        </div>
        <div className="w-px h-16 bg-white/20" />
        <div className="text-center">
          <div className="text-sm uppercase tracking-[0.3em] text-white/40 mb-2">
            Local Time
          </div>
          <div className="text-4xl font-bold text-white/80 tabular-nums">
            {two(clock.hour)}:{two(clock.minute)}
          </div>
        </div>
      </div>
    </div>
  </SlideWrapper>
);

// 2. Clock Slide - Big beautiful clock
const ClockSlide: React.FC<{
  clock: ReturnType<typeof nowInTz>;
  next: ReturnType<typeof getNextPrayer>;
}> = ({ clock, next }) => (
  <SlideWrapper>
    <div className="text-center">
      <div className="text-[clamp(8rem,20vw,16rem)] font-black leading-none text-white tabular-nums">
        {two(clock.hour)}:{two(clock.minute)}
        <span className="text-white/30">:{two(clock.second)}</span>
      </div>

      <div className="mt-8 text-3xl text-white/50">
        {clock.weekday}, {two(clock.day)}.{two(clock.month)}.{clock.year}
      </div>

      {next && (
        <div className="mt-12 inline-flex items-center gap-4 px-8 py-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
          <span className="text-2xl">{PRAYER_ICONS[next.key]}</span>
          <span className="text-2xl text-white/70">Next:</span>
          <span className="text-2xl font-bold text-white">
            {PRAYER_LABELS[next.key]}
          </span>
          <span className="text-2xl text-emerald-400 font-bold">
            in {formatCountdown(next.diff)}
          </span>
        </div>
      )}
    </div>
  </SlideWrapper>
);

// 3. All Prayers Slide - Clean grid
const PrayersSlide: React.FC<{
  prayers: PrayerRow[];
  next: ReturnType<typeof getNextPrayer>;
  tz: string;
}> = ({ prayers, next }) => (
  <SlideWrapper gradient="bg-gradient-to-b from-slate-900/50 to-transparent">
    <div className="text-center mb-12">
      <div className="text-sm uppercase tracking-[0.4em] text-emerald-400 mb-4">
        Todays Schedule
      </div>
      <h2 className="text-5xl font-black text-white">Prayer Times</h2>
    </div>

    <div className="grid grid-cols-5 gap-6">
      {PRAYER_ORDER.map((key) => {
        const row = prayers.find((p) => p.prayer === key);
        const isNext = next?.key === key;

        return (
          <div
            key={key}
            className={`relative rounded-3xl p-8 text-center transition-all ${
              isNext
                ? "bg-emerald-500 text-emerald-950 scale-105 shadow-2xl shadow-emerald-500/30"
                : "bg-white/5 text-white border border-white/10"
            }`}
          >
            {isNext && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-white text-emerald-950 text-xs font-bold uppercase tracking-wider">
                Next
              </div>
            )}

            <div className="text-4xl mb-4">{PRAYER_ICONS[key]}</div>
            <div
              className={`text-2xl font-bold mb-6 ${
                isNext ? "" : "text-white/90"
              }`}
            >
              {PRAYER_LABELS[key]}
            </div>

            <div
              className={`text-sm uppercase tracking-wider mb-2 ${
                isNext ? "text-emerald-950/60" : "text-white/40"
              }`}
            >
              Adhan
            </div>
            <div
              className={`text-3xl font-bold tabular-nums mb-6 ${
                isNext ? "" : "text-white/70"
              }`}
            >
              {formatTime(row?.start_time)}
            </div>

            <div
              className={`text-sm uppercase tracking-wider mb-2 ${
                isNext ? "text-emerald-950/60" : "text-white/40"
              }`}
            >
              Iqama
            </div>
            <div className="text-4xl font-black tabular-nums">
              {formatTime(row?.jamaat_time)}
            </div>
          </div>
        );
      })}
    </div>
  </SlideWrapper>
);

// 4. Next Prayer Focus - Dramatic single prayer highlight
const NextPrayerSlide: React.FC<{
  next: ReturnType<typeof getNextPrayer>;
  clock: ReturnType<typeof nowInTz>;
}> = ({ next, clock }) => {
  if (!next) return null;

  return (
    <SlideWrapper gradient="bg-gradient-to-br from-emerald-900/40 via-transparent to-emerald-900/20">
      <div className="text-center">
        <div className="text-8xl mb-8">{PRAYER_ICONS[next.key]}</div>

        <div className="text-sm uppercase tracking-[0.4em] text-emerald-400 mb-4">
          Coming Up
        </div>
        <h2 className="text-[clamp(4rem,10vw,10rem)] font-black text-white leading-none">
          {PRAYER_LABELS[next.key]}
        </h2>

        <div className="mt-12 flex items-center justify-center gap-12">
          <div className="text-center">
            <div className="text-sm uppercase tracking-[0.3em] text-white/40 mb-3">
              Iqama At
            </div>
            <div className="text-6xl font-black text-white tabular-nums">
              {formatTime(next.row.jamaat_time)}
            </div>
          </div>

          <div className="w-px h-24 bg-white/20" />

          <div className="text-center">
            <div className="text-sm uppercase tracking-[0.3em] text-white/40 mb-3">
              Starting In
            </div>
            <div className="text-6xl font-black text-emerald-400">
              {formatCountdown(next.diff)}
            </div>
          </div>
        </div>

        <div className="mt-12 text-2xl text-white/40">
          Current time: {two(clock.hour)}:{two(clock.minute)}
        </div>
      </div>
    </SlideWrapper>
  );
};

// 5. Jumu'ah Slide
const JumuahSlide: React.FC<{ slots: JumuahRow[] }> = ({ slots }) => (
  <SlideWrapper gradient="bg-gradient-to-br from-amber-900/30 via-transparent to-emerald-900/20">
    <div className="text-center mb-12">
      <div className="text-7xl mb-6">🕌</div>
      <div className="text-sm uppercase tracking-[0.4em] text-amber-400 mb-4">
        Friday Special
      </div>
      <h2 className="text-6xl font-black text-white">Jumuah</h2>
    </div>

    <div
      className={`grid gap-6 ${
        slots.length === 1
          ? "max-w-lg mx-auto"
          : slots.length === 2
          ? "grid-cols-2 max-w-3xl mx-auto"
          : "grid-cols-3"
      }`}
    >
      {slots.map((slot) => (
        <div
          key={slot.id}
          className="rounded-3xl bg-white/5 border border-white/10 p-8 text-center"
        >
          <div className="text-sm uppercase tracking-wider text-white/40 mb-2">
            Slot {slot.slot}
          </div>
          {slot.language && (
            <div className="inline-block px-4 py-1 rounded-full bg-amber-500/20 text-amber-300 text-sm font-medium mb-6">
              {slot.language}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
                Khutbah
              </div>
              <div className="text-3xl font-black text-white tabular-nums">
                {formatTime(slot.khutbah_time)}
              </div>
            </div>
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4">
              <div className="text-xs uppercase tracking-wider text-emerald-400/70 mb-2">
                Iqama
              </div>
              <div className="text-3xl font-black text-emerald-400 tabular-nums">
                {formatTime(slot.jamaat_time)}
              </div>
            </div>
          </div>

          {slot.notes && (
            <div className="mt-4 text-sm text-white/50">{slot.notes}</div>
          )}
        </div>
      ))}
    </div>
  </SlideWrapper>
);

// 6. Announcement Slide - One announcement at a time
const AnnouncementSlide: React.FC<{ announcement: AnnouncementRow }> = ({
  announcement,
}) => (
  <SlideWrapper
    gradient={
      announcement.is_pinned
        ? "bg-gradient-to-br from-amber-900/30 via-transparent to-transparent"
        : "bg-gradient-to-br from-cyan-900/20 via-transparent to-transparent"
    }
  >
    <div className="text-center max-w-4xl mx-auto">
      {announcement.is_pinned && (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/20 border border-amber-500/30 mb-8">
          <span className="text-xl">📌</span>
          <span className="text-amber-300 font-medium uppercase tracking-wider">
            Pinned
          </span>
        </div>
      )}

      <div className="text-sm uppercase tracking-[0.4em] text-white/40 mb-6">
        Announcement
      </div>

      <h2 className="text-[clamp(2.5rem,5vw,4rem)] font-black text-white leading-tight">
        {announcement.title}
      </h2>

      <div className="mt-8 text-[clamp(1.25rem,2.5vw,1.75rem)] text-white/70 leading-relaxed">
        {announcement.body}
      </div>

      <div className="mt-12 inline-block px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 uppercase tracking-wider text-sm">
        {announcement.category}
      </div>
    </div>
  </SlideWrapper>
);

// 7. Weather Slide
const WeatherSlide: React.FC<{ weather: WeatherOut }> = ({ weather }) => (
  <SlideWrapper gradient="bg-gradient-to-br from-cyan-900/30 via-transparent to-blue-900/20">
    <div className="text-center mb-12">
      <div className="text-sm uppercase tracking-[0.4em] text-cyan-400 mb-4">
        Local Weather
      </div>
      <h2 className="text-5xl font-black text-white">
        {weather.location.name}
      </h2>
    </div>

    {weather.current && (
      <div className="text-center mb-16">
        <div className="text-[8rem] leading-none mb-4">
          {wxEmoji(weather.current.weathercode)}
        </div>
        <div className="text-[clamp(4rem,10vw,8rem)] font-black text-white">
          {weather.current.temperature != null
            ? `${Math.round(weather.current.temperature)}°`
            : "—"}
        </div>
      </div>
    )}

    <div className="grid grid-cols-3 gap-6 max-w-3xl mx-auto">
      {weather.daily.slice(0, 3).map((d) => (
        <div
          key={d.date}
          className="rounded-3xl bg-white/5 border border-white/10 p-6 text-center"
        >
          <div className="text-lg text-white/50 mb-4">{d.date.slice(5)}</div>
          <div className="text-5xl mb-4">{wxEmoji(d.weathercode)}</div>
          <div className="text-2xl font-bold text-white">
            {d.tmax != null ? Math.round(d.tmax) : "—"}°
            <span className="text-white/40 mx-2">/</span>
            {d.tmin != null ? Math.round(d.tmin) : "—"}°
          </div>
        </div>
      ))}
    </div>
  </SlideWrapper>
);

// 8. Hadith Slide
const HadithSlide: React.FC<{ hadith: HadithOut }> = ({ hadith }) => (
  <SlideWrapper gradient="bg-gradient-to-br from-violet-900/20 via-transparent to-emerald-900/10">
    <div className="text-center max-w-4xl mx-auto">
      <div className="text-6xl mb-8">📖</div>
      <div className="text-sm uppercase tracking-[0.4em] text-violet-400 mb-6">
        Daily Hadith
      </div>

      <blockquote className="text-[clamp(1.5rem,3vw,2.25rem)] text-white/90 leading-relaxed">
        <span className="text-emerald-400 text-4xl font-serif">&ldquo;</span>
        {hadith.text}
        <span className="text-emerald-400 text-4xl font-serif">&rdquo;</span>
      </blockquote>

      <div className="mt-12 flex items-center justify-center gap-4 text-white/50">
        <span className="text-lg">{hadith.collection}</span>
        <span className="text-white/20">•</span>
        <span className="text-lg">#{hadith.hadithnumber}</span>
        {hadith.grade && (
          <>
            <span className="text-white/20">•</span>
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm">
              {hadith.grade}
            </span>
          </>
        )}
      </div>
    </div>
  </SlideWrapper>
);

// 9. QR/Download Slide (Play + Apple)
const QRSlide: React.FC<{ masjid: Masjid }> = ({ masjid }) => (
  <SlideWrapper gradient="bg-gradient-to-br from-emerald-900/30 via-transparent to-cyan-900/20">
    <div className="flex items-center justify-center gap-16">
      <div className="text-center max-w-xl">
        <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-8">
          <div className="w-3 h-3 rounded-full bg-emerald-400" />
          <span className="text-emerald-300 uppercase tracking-[0.3em]">
            UmmahWay App
          </span>
        </div>

        <h2 className="text-5xl font-black text-white mb-6">
          Get Prayer Times<br />
          on Your Phone
        </h2>

        <p className="text-xl text-white/50">
          Scan to download and connect with{" "}
          {masjid.short_name || masjid.official_name}
        </p>

        <div className="mt-8 text-sm text-white/35 uppercase tracking-[0.3em]">
          Android • iPhone
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-3xl bg-white p-6 shadow-2xl shadow-emerald-500/20 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-600 mb-3">
            Google Play
          </div>
          <QRCode value={PLAY_STORE_URL} size={210} />
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-2xl shadow-cyan-500/20 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-600 mb-3">
            App Store
          </div>
          <QRCode value={APPLE_STORE_URL} size={210} />
        </div>
      </div>
    </div>
  </SlideWrapper>
);

/* =========================================================
   Masjid Selector - Shows when no masjid is selected
   ========================================================= */
type SelectableMasjid = {
  id: string;
  official_name: string;
  short_name?: string | null;
  city: string | null;
  region?: string | null;
  is_active: boolean;
};

const MasjidSelector: React.FC = () => {
  const router = useRouter();
  const [masjids, setMasjids] = useState<SelectableMasjid[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("public_masjids")
        .select("id, official_name, short_name, city, region, is_active")
        .eq("is_active", true)
        .order("city")
        .order("official_name");
      setMasjids((data ?? []) as SelectableMasjid[]);
      setLoading(false);
    };
    load();
  }, []);

  // Get unique cities
  const cities = useMemo(() => {
    const citySet = new Set(masjids.map((m) => m.city).filter(Boolean));
    return Array.from(citySet).sort() as string[];
  }, [masjids]);

  // Filter masjids
  const filteredMasjids = useMemo(() => {
    return masjids.filter((m) => {
      const matchesCity = !selectedCity || m.city === selectedCity;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        m.official_name.toLowerCase().includes(q) ||
        (m.short_name?.toLowerCase().includes(q) ?? false) ||
        (m.city?.toLowerCase().includes(q) ?? false);
      return matchesCity && matchesSearch;
    });
  }, [masjids, selectedCity, searchQuery]);

  const selectMasjid = (id: string) => {
    router.push(`/?masjid=${id}`);
  };

  return (
    <div className="fixed inset-0 noor-bg text-white overflow-hidden">
      <div className="noise" />

      {/* Background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 h-full flex flex-col p-8 lg:p-12">
        {/* Header */}
        <div className="text-center mb-8 lg:mb-12">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-6">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300 uppercase tracking-[0.3em] text-sm">
              TV Display Setup
            </span>
          </div>

          <h1 className="text-4xl lg:text-6xl font-black mb-4">
            Select Your Masjid
          </h1>
          <p className="text-xl text-white/50 max-w-2xl mx-auto">
            Choose a masjid to display prayer times, announcements, and more
          </p>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col lg:flex-row items-center justify-center gap-4 mb-8">
          {/* Search */}
          <div className="relative w-full max-w-md">
            <input
              type="text"
              placeholder="Search masjids..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-lg focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* City filter */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <button
              onClick={() => setSelectedCity(null)}
              className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                !selectedCity
                  ? "bg-emerald-500 text-emerald-950"
                  : "bg-white/5 text-white/70 hover:bg-white/10 border border-white/10"
              }`}
            >
              All Cities
            </button>
            {cities.map((city) => (
              <button
                key={city}
                onClick={() => setSelectedCity(city)}
                className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                  selectedCity === city
                    ? "bg-emerald-500 text-emerald-950"
                    : "bg-white/5 text-white/70 hover:bg-white/10 border border-white/10"
                }`}
              >
                {city}
              </button>
            ))}
          </div>
        </div>

        {/* Masjid Grid */}
        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-12 h-12 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin" />
            </div>
          ) : filteredMasjids.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">🕌</div>
              <p className="text-xl text-white/50">No masjids found</p>
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCity(null);
                  }}
                  className="mt-4 px-6 py-3 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-all"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6 pb-8">
              {filteredMasjids.map((masjid) => (
                <button
                  key={masjid.id}
                  onClick={() => selectMasjid(masjid.id)}
                  className="group relative rounded-3xl bg-white/5 border border-white/10 p-6 text-left transition-all hover:bg-white/10 hover:border-emerald-500/30 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/10"
                >
                  {/* Hover glow */}
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="relative z-10">
                    {/* Icon */}
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                      <span className="text-2xl">🕌</span>
                    </div>

                    {/* Name */}
                    <h3 className="text-xl font-bold text-white mb-1 line-clamp-2">
                      {masjid.short_name || masjid.official_name}
                    </h3>

                    {/* Location */}
                    {masjid.city && (
                      <p className="text-white/50 flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        {masjid.city}
                        {masjid.region && (
                          <span className="text-white/30">· {masjid.region}</span>
                        )}
                      </p>
                    )}

                    {/* Arrow */}
                    <div className="absolute bottom-6 right-6 w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                      <svg
                        className="w-5 h-5 text-emerald-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-6 flex items-center justify-between border-t border-white/10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
              <span className="text-sm font-bold text-white">UW</span>
            </div>
            <div>
              <div className="font-semibold text-white">UmmahWay TV</div>
              <div className="text-sm text-white/50">Digital Masjid Display</div>
            </div>
          </div>

          <div className="flex items-center gap-6 text-sm text-white/40">
            <div>
              <span className="text-white/60">{masjids.length}</span> masjids
              available
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* =========================================================
   Main Component
   ========================================================= */
export default function TVClient() {
  const sp = useSearchParams();
  const masjidId = sp.get("masjid");
  const cycleSec = Math.max(6, Number(sp.get("cycle") ?? 10));
  const tzOverride = sp.get("tz");

  // If no masjid ID, show the selector
  if (!masjidId) {
    return <MasjidSelector />;
  }

  return (
    <TVDisplay masjidId={masjidId} cycleSec={cycleSec} tzOverride={tzOverride} />
  );
}

/* =========================================================
   TV Display Component
   - Fullscreen gate overlay: ONLY clickable thing until fullscreen entered
   - Exit fullscreen button (minimize) + auto-hide controls on inactivity
   ========================================================= */
function TVDisplay({
  masjidId,
  cycleSec,
  tzOverride,
}: {
  masjidId: string;
  cycleSec: number;
  tzOverride: string | null;
}) {
  const router = useRouter();
  const alive = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [masjid, setMasjid] = useState<Masjid | null>(null);
  const [prayers, setPrayers] = useState<PrayerRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [jumuahSlots, setJumuahSlots] = useState<JumuahRow[]>([]);
  const [weather, setWeather] = useState<WeatherOut | null>(null);
  const [hadith, setHadith] = useState<HadithOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clock, setClock] = useState(() => nowInTz("Europe/Rome"));
  const tz = tzOverride || masjid?.timezone || "Europe/Rome";
  const todayKey = useMemo(() => ymd(clock), [clock]);
  const isFriday = clock.weekday === "Friday";

  const [currentSlide, setCurrentSlide] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Fullscreen + gate
  const [isFs, setIsFs] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);

  // Controls auto-hide (only after fullscreen is active)
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const armHideControls = () => {
    if (!isFs) return;
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3500);
  };

  const enterFullscreen = async () => {
    setFsError(null);
    try {
      const el = rootRef.current || document.documentElement;
      await requestFullscreenFor(el as HTMLElement);
      // state updates on fullscreenchange
    } catch (e) {
      setFsError(
        e instanceof Error
          ? e.message
          : "Fullscreen request was blocked. Try again."
      );
    }
  };

  const leaveFullscreen = async () => {
    setFsError(null);
    try {
      await exitFullscreen();
      // state updates on fullscreenchange
    } catch (e) {
      setFsError(e instanceof Error ? e.message : "Could not exit fullscreen.");
    }
  };

  // Listen fullscreen changes
  useEffect(() => {
    const onFsChange = () => {
      const fs = isFullscreenNow();
      setIsFs(fs);
      if (fs) {
        setShowControls(true);
        armHideControls();
      } else {
        setShowControls(true);
      }
    };

    const handler = onFsChange as EventListener;

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", handler);
    document.addEventListener("mozfullscreenchange", handler);
    document.addEventListener("MSFullscreenChange", handler);

    // init
    onFsChange();

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", handler);
      document.removeEventListener("mozfullscreenchange", handler);
      document.removeEventListener("MSFullscreenChange", handler);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Keyboard shortcuts for TV / remote keyboards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (!isFs) enterFullscreen();
        else armHideControls();
      }
      if (e.key === "Escape") {
        // browsers exit automatically on ESC, but keep it safe
        if (isFs) leaveFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFs]);

  // Lock scroll
  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  // Clock tick
  useEffect(() => {
    const tick = () => setClock(nowInTz(tz));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tz]);

  // Load data
  const loadData = async (mId: string) => {
    try {
      const { data: m } = await supabase
        .from("public_masjids")
        .select("*")
        .eq("id", mId)
        .maybeSingle();

      if (!m) throw new Error("Masjid not found");
      if (!alive.current) return;

      const mMasjid = m as Masjid;
      setMasjid(mMasjid);

      const tzForMasjid = tzOverride || mMasjid.timezone || "Europe/Rome";
      const today = ymd(nowInTz(tzForMasjid));

      const { data: p } = await supabase
        .from("masjid_prayer_times")
        .select("*")
        .eq("masjid_id", mId)
        .eq("date", today);
      if (alive.current) setPrayers((p ?? []) as PrayerRow[]);

      const { data: a } = await supabase
        .from("masjid_announcements")
        .select("*")
        .eq("masjid_id", mId)
        .or("starts_at.is.null,starts_at.lte.now()")
        .or("ends_at.is.null,ends_at.gte.now()")
        .order("is_pinned", { ascending: false })
        .limit(5);
      if (alive.current) setAnnouncements((a ?? []) as AnnouncementRow[]);

      const { data: j } = await supabase
        .from("masjid_jumuah_times")
        .select("*")
        .eq("masjid_id", mId)
        .order("slot")
        .limit(4);
      if (alive.current) {
        const active = (j ?? []).filter(
          (r: JumuahRow) =>
            (!r.valid_from || r.valid_from <= today) &&
            (!r.valid_to || r.valid_to >= today)
        );
        setJumuahSlots(active as JumuahRow[]);
      }

      // Weather
      if (mMasjid.city || mMasjid.latitude) {
        const qs = new URLSearchParams();
        if (mMasjid.city) qs.set("city", mMasjid.city);
        qs.set("tz", tzForMasjid);
        if (mMasjid.latitude) qs.set("lat", String(mMasjid.latitude));
        if (mMasjid.longitude) qs.set("lon", String(mMasjid.longitude));
        fetch(`/api/weather?${qs}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => alive.current && d && setWeather(d))
          .catch(() => {});
      }

      // Hadith
      fetch(`/api/hadith?edition=eng-bukhari&seed=${today}:${mId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive.current && d && setHadith(d))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  };

  useEffect(() => {
    alive.current = true;
    loadData(masjidId);
    return () => {
      alive.current = false;
    };
  }, [masjidId, todayKey]);

  // Build slides array
  const slides = useMemo(() => {
    const arr: SlideType[] = ["welcome", "clock", "prayers"];
    const next = getNextPrayer(prayers, tz);
    if (next) arr.push("next-prayer");
    if (isFriday && jumuahSlots.length > 0) arr.push("jumuah");
    announcements.forEach(() => arr.push("announcement"));
    if (weather) arr.push("weather");
    if (hadith) arr.push("hadith");
    arr.push("qr");
    return arr;
  }, [prayers, tz, isFriday, jumuahSlots, announcements, weather, hadith]);

  // Slide rotation
  useEffect(() => {
    if (slides.length === 0) return;

    let startTime = Date.now();
    setCurrentSlide(0);
    setProgress(0);

    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setProgress(Math.min(1, elapsed / cycleSec));
    }, 50);

    const slideInterval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
        setIsTransitioning(false);
        startTime = Date.now();
        setProgress(0);
      }, 300);
    }, cycleSec * 1000);

    return () => {
      clearInterval(progressInterval);
      clearInterval(slideInterval);
    };
  }, [slides.length, cycleSec]);

  const next = useMemo(
    () => getNextPrayer(prayers, tz),
    [prayers, tz, clock]
  );

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 noor-bg text-white flex items-center justify-center p-8">
        <div className="noise" />
        <div className="glass rounded-3xl p-12 text-center max-w-xl relative z-10">
          <div className="text-6xl mb-6">⚠️</div>
          <h1 className="text-3xl font-black mb-4">Display Error</h1>
          <p className="text-white/60 text-lg mb-8">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-8 py-4 rounded-2xl bg-emerald-500 text-emerald-950 font-bold text-lg hover:bg-emerald-400 transition-colors"
          >
            Select a Masjid
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!masjid) {
    return (
      <div className="fixed inset-0 noor-bg text-white flex items-center justify-center">
        <div className="noise" />
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin mx-auto mb-8" />
          <h1 className="text-3xl font-black">Loading Display</h1>
          <p className="mt-2 text-white/50">Connecting to masjid...</p>
        </div>
      </div>
    );
  }

  // Get current announcement for announcement slides
  const announcementIndex =
    slides.slice(0, currentSlide + 1).filter((s) => s === "announcement")
      .length - 1;

  // Render current slide
  const renderSlide = () => {
    const slideType = slides[currentSlide];
    switch (slideType) {
      case "welcome":
        return <WelcomeSlide masjid={masjid} clock={clock} />;
      case "clock":
        return <ClockSlide clock={clock} next={next} />;
      case "prayers":
        return <PrayersSlide prayers={prayers} next={next} tz={tz} />;
      case "next-prayer":
        return next ? <NextPrayerSlide next={next} clock={clock} /> : null;
      case "jumuah":
        return <JumuahSlide slots={jumuahSlots} />;
      case "announcement":
        return announcements[announcementIndex] ? (
          <AnnouncementSlide announcement={announcements[announcementIndex]} />
        ) : null;
      case "weather":
        return weather ? <WeatherSlide weather={weather} /> : null;
      case "hadith":
        return hadith ? <HadithSlide hadith={hadith} /> : null;
      case "qr":
        return <QRSlide masjid={masjid} />;
      default:
        return null;
    }
  };

  const gateActive = !isFs; // Only clickable thing is fullscreen gate until fullscreen is active

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 noor-bg text-white overflow-hidden"
      onMouseMove={armHideControls}
      onPointerDown={armHideControls}
    >
      <div className="noise" />

      {/* Progress bar */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 bg-white/5 z-50 transition-opacity ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-100"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Slide dots */}
      <div
        className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50 transition-opacity ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        {slides.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all ${
              i === currentSlide ? "bg-emerald-400 w-8" : "bg-white/20"
            }`}
          />
        ))}
      </div>

      {/* Branding (Play + Apple mini QR) */}
      <div
        className={`absolute bottom-8 right-8 flex items-center gap-4 z-50 transition-opacity ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">
            Powered by
          </div>
          <div className="text-lg font-bold text-white/70">UmmahWay</div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 mt-1">
            Android • iPhone
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-white p-2">
            <QRCode value={PLAY_STORE_URL} size={44} />
          </div>
          <div className="rounded-xl bg-white p-2">
            <QRCode value={APPLE_STORE_URL} size={44} />
          </div>
        </div>
      </div>

      {/* Current time badge */}
      <div
        className={`absolute top-8 right-8 z-50 transition-opacity ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="glass rounded-2xl px-6 py-3 flex items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="text-2xl font-bold tabular-nums">
            {two(clock.hour)}:{two(clock.minute)}
            <span className="text-white/30">:{two(clock.second)}</span>
          </div>
        </div>
      </div>

      {/* Back to selector button (only after fullscreen) */}
      <button
        onClick={() => router.push("/")}
        className={`absolute top-8 left-8 z-50 glass rounded-2xl px-5 py-3 flex items-center gap-3 text-white/60 hover:text-white hover:bg-white/10 transition-all
          ${showControls ? "opacity-100" : "opacity-0"}
        `}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        <span className="font-medium">Change Masjid</span>
      </button>

      {/* Minimize (Exit Fullscreen) button */}
      <button
        onClick={leaveFullscreen}
        className={`absolute top-8 left-[190px] z-50 glass rounded-2xl px-5 py-3 flex items-center gap-3 text-white/60 hover:text-white hover:bg-white/10 transition-all
          ${showControls ? "opacity-100" : "opacity-0"}
        `}
        aria-label="Exit fullscreen"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 9h6v6H9z"
          />
        </svg>
        <span className="font-medium">Minimize</span>
      </button>

      {/* Slide content */}
      <div
        className={`transition-opacity duration-300 ${
          isTransitioning ? "opacity-0" : "opacity-100"
        }`}
      >
        {renderSlide()}
      </div>

      {/* FULLSCREEN GATE OVERLAY (ONLY CLICKABLE THING when not fullscreen) */}
      {gateActive && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center">
          {/* Dim */}
          <div className="absolute inset-0 bg-black/70" />

          {/* The ONLY clickable area */}
          <button
            onClick={enterFullscreen}
            className="relative z-10 w-full h-full flex items-center justify-center outline-none"
            aria-label="Enter fullscreen"
          >
            <div className="glass rounded-[32px] px-10 py-10 text-center max-w-2xl mx-8 border border-white/10">
              <div className="text-7xl mb-6">📺</div>
              <h1 className="text-4xl font-black text-white">
                Tap to Start Fullscreen
              </h1>
              <p className="mt-4 text-white/60 text-lg leading-relaxed">
                This TV display runs in fullscreen for the best experience.
                <br />
                Press <span className="text-white/80 font-semibold">Enter</span>{" "}
                on a remote keyboard, or click once.
              </p>

              {fsError && (
                <div className="mt-6 text-amber-300 text-sm">
                  {fsError}
                </div>
              )}

              <div className="mt-10 inline-flex items-center gap-3 px-7 py-4 rounded-2xl bg-emerald-500 text-emerald-950 font-black text-lg">
                Enter Fullscreen
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"
                  />
                </svg>
              </div>

              <div className="mt-6 text-xs uppercase tracking-[0.35em] text-white/30">
                UmmahWay • TV Mode
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
