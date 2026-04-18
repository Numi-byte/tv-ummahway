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
type TVSettingsRow = {
  masjid_id: string;
  slide_duration_seconds: number;
  enabled_slides: string[];
  theme: string;
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
const PRAYER_LABELS_AR: Record<PrayerKey, string> = {
  fajr: "الفجر",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
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
const minsToTime = (mins: number) => {
  const safe = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${two(Math.floor(safe / 60))}:${two(safe % 60)}`;
};
const shiftTimeByMinutes = (time: string, delta: number) => {
  const mins = timeToMins(time);
  if (mins == null) return time;
  return minsToTime(mins + delta);
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

function formatGregorianDate(tz: string | null) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function formatHijriDate(tz: string | null) {
  return new Intl.DateTimeFormat("en-GB-u-ca-islamic", {
    timeZone: tz || "Europe/Rome",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function ordinal(slot: number) {
  const mod100 = slot % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${slot}th`;
  const mod10 = slot % 10;
  if (mod10 === 1) return `${slot}st`;
  if (mod10 === 2) return `${slot}nd`;
  if (mod10 === 3) return `${slot}rd`;
  return `${slot}th`;
}

function getDeviceTimezone() {
  if (typeof Intl === "undefined") return null;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

function resolveActiveTimezone({
  tzOverride,
  deviceTz,
  masjidTz,
}: {
  tzOverride: string | null;
  deviceTz: string | null;
  masjidTz: string | null;
}) {
  const normalizedOverride = tzOverride?.trim().toLowerCase() ?? null;
  if (
    normalizedOverride &&
    ["local", "device", "device-local", "device_local"].includes(
      normalizedOverride
    )
  ) {
    return deviceTz || masjidTz || "Europe/Rome";
  }
  return tzOverride || deviceTz || masjidTz || "Europe/Rome";
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

const CACHE_VERSION = 1;
const selectorCacheKey = `ummahway:selector:${CACHE_VERSION}`;
const displayCacheKey = (masjidId: string) =>
  `ummahway:display:${masjidId}:${CACHE_VERSION}`;

function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort cache only.
  }
}

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
  fullWidth?: boolean;
}> = ({ children, gradient, fullWidth = false }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12 overflow-hidden">
    {gradient && <div className={`absolute inset-0 ${gradient} opacity-30`} />}
    <div className={`relative z-10 w-full ${fullWidth ? "h-full" : "max-w-6xl"}`}>
      {children}
    </div>
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
  <SlideWrapper
    fullWidth
    gradient="bg-[radial-gradient(circle_at_top,rgba(180,140,70,0.35),transparent_50%),linear-gradient(180deg,rgba(4,47,46,0.85)_0%,rgba(2,6,23,0.95)_70%)]"
  >
    <div className="relative h-full rounded-[2.5rem] border border-amber-500/20 bg-slate-950/50 px-10 py-12 shadow-[0_0_80px_rgba(245,158,11,0.08)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 islamic-pattern opacity-25" />

      <div className="relative text-center mb-12">
        <div className="text-sm uppercase tracking-[0.45em] text-amber-300/90 mb-3">
          Today&apos;s Schedule
        </div>
        <div className="text-2xl text-amber-200/80 mb-4">مواقيت الصلاة</div>
        <h2 className="text-6xl font-black text-white">Daily Prayers</h2>
      </div>

      <div className="relative grid grid-cols-5 gap-6 h-[calc(100%-10rem)]">
        {PRAYER_ORDER.map((key) => {
          const row = prayers.find((p) => p.prayer === key);
          const isNext = next?.key === key;

          return (
            <div
              key={key}
              className={`relative rounded-t-[5rem] rounded-b-3xl p-8 text-center transition-all flex flex-col justify-between border ${
                isNext
                  ? "bg-gradient-to-b from-amber-300 to-emerald-400 text-emerald-950 scale-[1.03] shadow-2xl shadow-amber-500/30 border-amber-100/70"
                  : "bg-slate-900/70 text-white border-amber-500/20"
              }`}
            >
              {isNext && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-white text-emerald-950 text-xs font-bold uppercase tracking-wider">
                  Next
                </div>
              )}

              <div>
                <div className="text-4xl mb-4">{PRAYER_ICONS[key]}</div>
                <div
                  className={`text-2xl font-bold ${isNext ? "" : "text-white"}`}
                >
                  {PRAYER_LABELS[key]}
                </div>
                <div
                  className={`text-xl mt-1 ${
                    isNext ? "text-emerald-950/80" : "text-amber-200/75"
                  }`}
                >
                  {PRAYER_LABELS_AR[key]}
                </div>
              </div>

              <div>
                <div
                  className={`text-sm uppercase tracking-wider mb-2 ${
                    isNext ? "text-emerald-950/60" : "text-white/50"
                  }`}
                >
                  Adhan
                </div>
                <div
                  className={`text-4xl font-bold tabular-nums mb-6 ${
                    isNext ? "" : "text-white/80"
                  }`}
                >
                  {formatTime(row?.start_time)}
                </div>

                <div
                  className={`text-sm uppercase tracking-wider mb-2 ${
                    isNext ? "text-emerald-950/60" : "text-white/50"
                  }`}
                >
                  Iqama
                </div>
                <div className="text-5xl font-black tabular-nums">
                  {formatTime(row?.jamaat_time)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
    <div className="text-center max-w-5xl mx-auto px-2 sm:px-4">
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

      <h2 className="text-[clamp(2rem,4.5vw,4rem)] font-black text-white leading-tight break-words">
        {announcement.title}
      </h2>

      <div className="mt-6 sm:mt-8 max-h-[42vh] md:max-h-[46vh] overflow-y-auto px-2 sm:px-4">
        <p className="text-[clamp(1.05rem,2.2vw,1.75rem)] text-white/70 leading-relaxed whitespace-pre-line break-words">
          {announcement.body}
        </p>
      </div>

      <div className="mt-8 sm:mt-12 inline-block px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 uppercase tracking-wider text-sm">
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
const HadithSlide: React.FC<{ hadith: HadithOut }> = ({ hadith }) => {
  const textScrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = textScrollerRef.current;
    if (!el) return;

    let frame = 0;
    let pauseUntil = 0;
    let direction: 1 | -1 = 1;
    let lastTs = 0;

    const step = (ts: number) => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 12) {
        el.scrollTop = 0;
        return;
      }

      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;

      if (ts >= pauseUntil) {
        const next = el.scrollTop + direction * (dt * 0.02);
        el.scrollTop = Math.min(maxScroll, Math.max(0, next));

        const reachedBottom = direction === 1 && el.scrollTop >= maxScroll - 2;
        const reachedTop = direction === -1 && el.scrollTop <= 2;

        if (reachedBottom || reachedTop) {
          direction = direction === 1 ? -1 : 1;
          pauseUntil = ts + 1500;
        }
      }

      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [hadith.text]);

  return (
    <SlideWrapper gradient="bg-gradient-to-br from-emerald-950 via-slate-950 to-amber-950/60">
      <div className="text-center max-w-6xl mx-auto w-full px-2 sm:px-4">
        <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full border border-amber-300/25 bg-amber-300/5 mb-6">
          <span className="text-amber-300 text-sm tracking-[0.38em] uppercase">
            حديث اليوم
          </span>
          <span className="text-amber-200/80">•</span>
          <span className="text-emerald-200/90 text-sm tracking-[0.32em] uppercase">
            Daily Hadith
          </span>
        </div>

        <div className="relative rounded-[2.25rem] border border-amber-200/20 bg-gradient-to-b from-amber-300/10 via-transparent to-emerald-300/10 p-4 sm:p-8 shadow-[0_25px_80px_rgba(0,0,0,0.45)] overflow-hidden">
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_top,_#fcd34d_0%,_transparent_35%),radial-gradient(circle_at_bottom,_#34d399_0%,_transparent_30%)]" />

          <div className="relative mx-auto max-w-5xl">
            <div className="text-3xl sm:text-5xl mb-4 text-amber-200">ﷺ</div>

            <div
              ref={textScrollerRef}
              className="max-h-[40vh] md:max-h-[46vh] overflow-y-auto px-2 sm:px-4 [scrollbar-width:thin] [scrollbar-color:rgba(245,158,11,0.65)_transparent]"
            >
              <blockquote className="text-[clamp(1.15rem,2.6vw,2.2rem)] text-white/95 leading-relaxed break-words">
                <span className="text-amber-300 text-3xl sm:text-4xl font-serif">
                  &ldquo;
                </span>{" "}
                {hadith.text}{" "}
                <span className="text-amber-300 text-3xl sm:text-4xl font-serif">
                  &rdquo;
                </span>
              </blockquote>
            </div>
          </div>
        </div>

        <div className="mt-7 sm:mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-white/60">
          <span className="text-lg uppercase tracking-[0.2em] text-amber-200/85">
            {hadith.collection}
          </span>
          <span className="text-white/25">•</span>
          <span className="text-lg text-emerald-100/90">#{hadith.hadithnumber}</span>
          {hadith.grade && (
            <>
              <span className="text-white/25">•</span>
              <span className="px-3 py-1 rounded-full border border-emerald-300/35 bg-emerald-400/10 text-emerald-200 text-sm uppercase tracking-[0.12em]">
                {hadith.grade}
              </span>
            </>
          )}
        </div>
      </div>
    </SlideWrapper>
  );
};

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
  const [masjids, setMasjids] = useState<SelectableMasjid[]>(() =>
    readCache<SelectableMasjid[]>(selectorCacheKey) ?? []
  );
  const [loading, setLoading] = useState(() =>
    (readCache<SelectableMasjid[]>(selectorCacheKey) ?? []).length === 0
  );
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMasjidIndex, setActiveMasjidIndex] = useState(0);
  const [activeCityIndex, setActiveCityIndex] = useState(0);
  const masjidButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cityButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("public_masjids")
        .select("id, official_name, short_name, city, region, is_active")
        .eq("is_active", true)
        .order("city")
        .order("official_name");
      const next = (data ?? []) as SelectableMasjid[];
      setMasjids(next);
      writeCache(selectorCacheKey, next);
      setLoading(false);
    };
    load().catch(() => setLoading(false));
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
  const normalizedActiveMasjidIndex =
    filteredMasjids.length > 0
      ? Math.min(activeMasjidIndex, filteredMasjids.length - 1)
      : 0;
  const cityOptions = ["All", ...cities];

  const selectMasjid = (id: string) => {
    router.push(`/?masjid=${id}`);
  };

  const getColumnCount = () => {
    if (typeof window === "undefined") return 1;
    if (window.innerWidth >= 1280) return 4;
    if (window.innerWidth >= 1024) return 3;
    if (window.innerWidth >= 768) return 2;
    return 1;
  };

  useEffect(() => {
    masjidButtonRefs.current = masjidButtonRefs.current.slice(
      0,
      filteredMasjids.length
    );
    if (filteredMasjids.length === 0) return;
    const button = masjidButtonRefs.current[normalizedActiveMasjidIndex];
    button?.focus();
  }, [filteredMasjids.length, normalizedActiveMasjidIndex]);

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (filteredMasjids.length === 0) return;
    const cols = getColumnCount();
    let nextIndex = normalizedActiveMasjidIndex;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = Math.min(
          normalizedActiveMasjidIndex + 1,
          filteredMasjids.length - 1
        );
        break;
      case "ArrowLeft":
        nextIndex = Math.max(normalizedActiveMasjidIndex - 1, 0);
        break;
      case "ArrowDown":
        nextIndex = Math.min(
          normalizedActiveMasjidIndex + cols,
          filteredMasjids.length - 1
        );
        break;
      case "ArrowUp":
        if (normalizedActiveMasjidIndex < cols) {
          event.preventDefault();
          const selectedIndex = selectedCity
            ? Math.max(0, cityOptions.indexOf(selectedCity))
            : 0;
          setActiveCityIndex(selectedIndex);
          cityButtonRefs.current[selectedIndex]?.focus();
          return;
        }
        nextIndex = Math.max(normalizedActiveMasjidIndex - cols, 0);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectMasjid(filteredMasjids[normalizedActiveMasjidIndex].id);
        return;
      default:
        return;
    }

    event.preventDefault();
    setActiveMasjidIndex(nextIndex);
  };

  const handleCityKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement | HTMLButtonElement>
  ) => {
    let nextIndex = activeCityIndex;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = Math.min(activeCityIndex + 1, cityOptions.length - 1);
        break;
      case "ArrowLeft":
        nextIndex = Math.max(activeCityIndex - 1, 0);
        break;
      case "ArrowDown":
        event.preventDefault();
        if (filteredMasjids.length > 0) {
          setActiveMasjidIndex(0);
          masjidButtonRefs.current[0]?.focus();
        }
        return;
      case "ArrowUp":
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        setSelectedCity(nextIndex === 0 ? null : cityOptions[nextIndex]);
        return;
      default:
        return;
    }

    event.preventDefault();
    setActiveCityIndex(nextIndex);
    cityButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="fixed inset-0 noor-bg text-white overflow-hidden">
      <div className="noise" />

      {/* Background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 h-full flex flex-col p-5 lg:p-8">
        {/* Header */}
        <div className="text-center mb-4 lg:mb-5">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300 uppercase tracking-[0.25em] text-xs lg:text-sm">
              TV Display Setup
            </span>
          </div>

          <h1 className="text-3xl lg:text-5xl font-black mb-2">
            Select Your Masjid
          </h1>
          <p className="text-base lg:text-lg text-white/50 max-w-2xl mx-auto">
            Choose a masjid to display prayer times, announcements, and more
          </p>
        </div>

        {/* Search & Filters */}
        <div className="mb-4 lg:mb-5 rounded-2xl border border-white/10 bg-white/5 p-3 lg:p-4">
          {/* Search */}
          <div className="relative w-full">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search masjids..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  cityButtonRefs.current[activeCityIndex]?.focus();
                }
              }}
              className="w-full px-5 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-white/35 text-base lg:text-lg focus:outline-none focus:border-emerald-500/50 focus:bg-white/10 transition-all"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30">
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
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* City filter */}
          <div
            className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onKeyDown={handleCityKeyDown}
          >
            <button
              onClick={() => {
                setSelectedCity(null);
                setActiveCityIndex(0);
              }}
              ref={(el) => {
                cityButtonRefs.current[0] = el;
              }}
              onFocus={() => setActiveCityIndex(0)}
              className={`whitespace-nowrap px-4 py-2 rounded-lg text-xs lg:text-sm font-semibold transition-all ${
                !selectedCity
                  ? "bg-emerald-500 text-emerald-950"
                  : "bg-white/5 text-white/70 hover:bg-white/10 border border-white/10"
              }`}
            >
              All Cities
            </button>
            {cities.map((city, cityIdx) => (
              <button
                key={city}
                onClick={() => {
                  setSelectedCity(city);
                  setActiveCityIndex(cityIdx + 1);
                }}
                ref={(el) => {
                  cityButtonRefs.current[cityIdx + 1] = el;
                }}
                onFocus={() => setActiveCityIndex(cityIdx + 1)}
                className={`whitespace-nowrap px-4 py-2 rounded-lg text-xs lg:text-sm font-semibold transition-all ${
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
        <div className="flex-1 overflow-auto min-h-0 pb-3">
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
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4 pb-5"
              onKeyDown={handleGridKeyDown}
            >
              {filteredMasjids.map((masjid, index) => (
                <button
                  key={masjid.id}
                  ref={(el) => {
                    masjidButtonRefs.current[index] = el;
                  }}
                  onClick={() => selectMasjid(masjid.id)}
                  onFocus={() => setActiveMasjidIndex(index)}
                  tabIndex={index === normalizedActiveMasjidIndex ? 0 : -1}
                  className="group relative rounded-2xl bg-white/5 border border-white/10 p-5 text-left transition-all hover:bg-white/10 hover:border-emerald-500/30 hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/60 focus-visible:border-emerald-400"
                >
                  {/* Hover glow */}
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="relative z-10">
                    {/* Icon */}
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3 group-hover:bg-emerald-500/20 transition-colors">
                      <span className="text-xl">🕌</span>
                    </div>

                    {/* Name */}
                    <h3 className="text-lg font-bold text-white mb-1 line-clamp-2">
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
                    <div className="absolute bottom-5 right-5 w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
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
        <div className="mt-3 shrink-0 pt-3 flex items-center justify-between border-t border-white/10 text-xs lg:text-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
              <span className="text-xs font-bold text-white">UW</span>
            </div>
            <div>
              <div className="font-semibold text-white">UmmahWay TV</div>
              <div className="text-white/50">Digital Masjid Display</div>
            </div>
          </div>

          <div className="flex items-center gap-6 text-white/40">
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
  const [tvSettings, setTvSettings] = useState<TVSettingsRow | null>(null);
  const [weather, setWeather] = useState<WeatherOut | null>(null);
  const [hadith, setHadith] = useState<HadithOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = readCache<{
      masjid: Masjid | null;
      prayers: PrayerRow[];
      announcements: AnnouncementRow[];
      jumuahSlots: JumuahRow[];
      weather: WeatherOut | null;
      hadith: HadithOut | null;
    }>(displayCacheKey(masjidId));

    if (!cached) return;

    if (cached.masjid) setMasjid(cached.masjid);
    if (cached.prayers?.length) setPrayers(cached.prayers);
    if (cached.announcements?.length) setAnnouncements(cached.announcements);
    if (cached.jumuahSlots?.length) setJumuahSlots(cached.jumuahSlots);
    if (cached.weather) setWeather(cached.weather);
    if (cached.hadith) setHadith(cached.hadith);
  }, [masjidId]);

  const [clock, setClock] = useState(() => nowInTz("Europe/Rome"));
  const deviceTz = useMemo(() => getDeviceTimezone(), []);
  const tz = resolveActiveTimezone({
    tzOverride,
    deviceTz,
    masjidTz: masjid?.timezone ?? null,
  });
  const todayKey = useMemo(() => ymd(clock), [clock]);
  const isFriday = clock.weekday === "Friday";

  const [currentSlide, setCurrentSlide] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const getSlideDurationSec = (slideType: SlideType | undefined) => {
    if (slideType === "prayers") return cycleSec * 2;
    return cycleSec;
  };

  // Fullscreen + gate
  const [isFs, setIsFs] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);

  // Controls auto-hide (only after fullscreen is active)
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });

  useEffect(() => {
    const updateViewport = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const safePadding = useMemo(() => {
    const smallerSide = Math.min(viewport.width, viewport.height);
    return Math.max(12, Math.round(smallerSide * 0.02));
  }, [viewport.height, viewport.width]);

  const stageMetrics = useMemo(() => {
    const BASE_WIDTH = 1920;
    const BASE_HEIGHT = 1080;

    const availableWidth = Math.max(360, viewport.width - safePadding * 2);
    const availableHeight = Math.max(240, viewport.height - safePadding * 2);
    const scale = Math.min(availableWidth / BASE_WIDTH, availableHeight / BASE_HEIGHT);

    return {
      baseWidth: BASE_WIDTH,
      baseHeight: BASE_HEIGHT,
      width: BASE_WIDTH * scale,
      height: BASE_HEIGHT * scale,
      scale,
    };
  }, [safePadding, viewport.height, viewport.width]);

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
      if (!supabase) {
        throw new Error(
          "Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
      }

      const { data: m } = await supabase
        .from("public_masjids")
        .select("*")
        .eq("id", mId)
        .maybeSingle();

      if (!m) throw new Error("Masjid not found");
      if (!alive.current) return;

      const mMasjid = m as Masjid;
      setMasjid(mMasjid);

      const tzForMasjid = resolveActiveTimezone({
        tzOverride,
        deviceTz,
        masjidTz: mMasjid.timezone,
      });
      const today = ymd(nowInTz(tzForMasjid));

      const { data: p } = await supabase
        .from("masjid_prayer_times")
        .select("*")
        .eq("masjid_id", mId)
        .eq("date", today);
      if (alive.current) setPrayers((p ?? []) as PrayerRow[]);

      const nowIso = new Date().toISOString();
      const { data: a } = await supabase
        .from("public.masjid_announcements")
        .select("id,title,body,category,is_pinned,starts_at,ends_at")
        .eq("masjid_id", mId)
        .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order("is_pinned", { ascending: false })
        .limit(5);
      if (alive.current) setAnnouncements((a ?? []) as AnnouncementRow[]);

      const { data: s } = await supabase
        .from("public.masjid_tv_settings")
        .select("masjid_id,slide_duration_seconds,enabled_slides,theme")
        .eq("masjid_id", mId)
        .maybeSingle();
      if (alive.current) setTvSettings((s as TVSettingsRow | null) ?? null);

      const { data: j } = await supabase
        .from("public.masjid_jumuah_times")
        .select(
          "id,slot,khutbah_time,jamaat_time,language,notes,valid_from,valid_to"
        )
        .eq("masjid_id", mId)
        .order("slot")
        .limit(8);
      if (alive.current) {
        const active = (j ?? []).filter(
          (r: JumuahRow) =>
            (!r.valid_from || r.valid_from <= today) &&
            (!r.valid_to || r.valid_to >= today)
        );
        const sorted = (active as JumuahRow[]).sort((a, b) => a.slot - b.slot);
        const deduped = sorted.filter(
          (slot, index, arr) => index === arr.findIndex((x) => x.slot === slot.slot)
        );

        if (deduped.length > 0) {
          setJumuahSlots(deduped);
        } else {
          const dhuhr = ((p ?? []) as PrayerRow[]).find((row) => row.prayer === "dhuhr");
          if (dhuhr?.jamaat_time) {
            setJumuahSlots([
              {
                id: -1,
                slot: 1,
                khutbah_time: shiftTimeByMinutes(dhuhr.jamaat_time, -15),
                jamaat_time: dhuhr.jamaat_time,
                language: null,
                notes: "Fallback from Dhuhr Jamaat",
                valid_from: today,
                valid_to: today,
              },
            ]);
          } else {
            setJumuahSlots([]);
          }
        }
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

      writeCache(displayCacheKey(mId), {
        masjid: mMasjid,
        prayers: (p ?? []) as PrayerRow[],
        announcements: (a ?? []) as AnnouncementRow[],
        jumuahSlots:
          ((j ?? [])
            .filter(
              (r: JumuahRow) =>
                (!r.valid_from || r.valid_from <= today) &&
                (!r.valid_to || r.valid_to >= today)
            )
            .sort((a: JumuahRow, b: JumuahRow) => a.slot - b.slot)
            .filter(
              (slot: JumuahRow, index: number, arr: JumuahRow[]) =>
                index === arr.findIndex((x) => x.slot === slot.slot)
            ) ?? []) as JumuahRow[],
        weather,
        hadith,
      });
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

  useEffect(() => {
    if (!masjid) return;
    writeCache(displayCacheKey(masjid.id), {
      masjid,
      prayers,
      announcements,
      jumuahSlots,
      weather,
      hadith,
    });
  }, [masjid, prayers, announcements, jumuahSlots, weather, hadith]);

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

  useEffect(() => {
    setCurrentSlide((prev) => (prev >= slides.length ? 0 : prev));
  }, [slides.length]);

  const activeSlideType = slides[currentSlide];
  const activeSlideDurationSec = getSlideDurationSec(activeSlideType);

  // Slide rotation
  useEffect(() => {
    if (slides.length === 0) return;

    const startTime = Date.now();
    setProgress(0);

    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setProgress(Math.min(1, elapsed / activeSlideDurationSec));
    }, 50);

    const slideTimeout = setTimeout(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
        setIsTransitioning(false);
      }, 300);
    }, activeSlideDurationSec * 1000);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(slideTimeout);
    };
  }, [slides, activeSlideDurationSec, currentSlide]);

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

  const todayRows = prayers.filter((p) => p.date === todayKey);
  const nextPrayerRow = next?.row ?? null;
  const currentMins = clock.hour * 60 + clock.minute;
  const currentSecondsOfDay = clock.hour * 3600 + clock.minute * 60 + clock.second;
  const activePrayer = todayRows.find((row) => {
    const adhanMins = timeToMins(row.start_time);
    const jamaatMins = timeToMins(row.jamaat_time);
    if (adhanMins == null || jamaatMins == null) return false;
    return currentMins >= adhanMins && currentMins < jamaatMins;
  });

  const minutesToAdhan = nextPrayerRow
    ? (timeToMins(nextPrayerRow.start_time) ?? 0) - currentMins
    : null;
  const minutesToJamaat = nextPrayerRow
    ? (timeToMins(nextPrayerRow.jamaat_time) ?? 0) - currentMins
    : null;
  const isQuietMode = Boolean(activePrayer);
  const isPreAdhanMode =
    !isQuietMode &&
    minutesToAdhan != null &&
    minutesToAdhan >= 0 &&
    minutesToAdhan <= 15;
  const isPostAdhanMode =
    !isQuietMode &&
    minutesToAdhan != null &&
    minutesToAdhan < 0 &&
    minutesToJamaat != null &&
    minutesToJamaat > 0;
  const isJumuahMode = isFriday && jumuahSlots.length > 0;

  const mainMode: "daily" | "pre-adhan" | "post-adhan" | "jumuah" | "silent" =
    isQuietMode
      ? "silent"
      : isJumuahMode
      ? "jumuah"
      : isPostAdhanMode
      ? "post-adhan"
      : isPreAdhanMode
      ? "pre-adhan"
      : "daily";

  const effectiveCycleSec = Math.max(4, tvSettings?.slide_duration_seconds ?? cycleSec);
  const announcementIndex = Math.floor(
    (Date.now() / 1000 / effectiveCycleSec) % Math.max(1, announcements.length)
  );
  const activeAnnouncement = announcements[announcementIndex] ?? null;
  const priority = (activeAnnouncement?.category || "").toLowerCase();
  const announcementLevel =
    activeAnnouncement?.is_pinned || priority.includes("urgent")
      ? "urgent"
      : priority.includes("important")
      ? "important"
      : "standard";
  const statusChipLabel =
    mainMode === "jumuah"
      ? "Jumuah today"
      : mainMode === "silent"
      ? "Jamaat in progress"
      : formatHijriDate(tz).toLowerCase().includes("ramadan")
      ? "Ramadan mode"
      : mainMode === "pre-adhan"
      ? "Silent mode soon"
      : "Sunrise";

  const nextAdhanSeconds =
    nextPrayerRow != null
      ? Math.max(
          0,
          ((timeToMins(nextPrayerRow.start_time) ?? currentMins) * 60) -
            currentSecondsOfDay
        )
      : 0;
  const nextJamaatSeconds =
    nextPrayerRow != null
      ? Math.max(
          0,
          ((timeToMins(nextPrayerRow.jamaat_time) ?? currentMins) * 60) -
            currentSecondsOfDay
        )
      : 0;
  const twoDigitTime = (sec: number) =>
    `${two(Math.floor(sec / 3600))}:${two(Math.floor((sec % 3600) / 60))}:${two(
      sec % 60
    )}`;
  const ringColor =
    mainMode === "silent"
      ? "rgba(255,255,255,0.12)"
      : mainMode === "jumuah"
      ? "rgba(251,191,36,0.7)"
      : mainMode === "post-adhan"
      ? "rgba(16,185,129,0.75)"
      : mainMode === "pre-adhan"
      ? "rgba(52,211,153,0.8)"
      : "rgba(148,163,184,0.55)";
  const prayerNameForHero = nextPrayerRow
    ? PRAYER_LABELS[nextPrayerRow.prayer]
    : "Next Prayer";
  const heroTitle =
    mainMode === "post-adhan"
      ? "Jamaat begins in"
      : mainMode === "pre-adhan"
      ? `${prayerNameForHero} in`
      : `Next Prayer: ${prayerNameForHero}`;
  const heroCountdown =
    mainMode === "post-adhan" ? twoDigitTime(nextJamaatSeconds) : twoDigitTime(nextAdhanSeconds);
  const hideAnnouncementRail = mainMode === "silent";
  const deemphasizeAnnouncementRail = mainMode === "post-adhan";

  const gateActive = !isFs; // Only clickable thing is fullscreen gate until fullscreen is active

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 noor-bg text-white overflow-hidden"
      onMouseMove={armHideControls}
      onPointerDown={armHideControls}
    >
      <div className="noise" />

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ padding: safePadding }}
      >
        <div
          className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/10 shadow-[0_30px_100px_rgba(2,6,23,0.7)]"
          style={{ width: stageMetrics.width, height: stageMetrics.height }}
        >
          <div
            className="absolute inset-0 origin-top-left"
            style={{
              width: stageMetrics.baseWidth,
              height: stageMetrics.baseHeight,
              transform: `scale(${stageMetrics.scale})`,
            }}
          >
            <div className="absolute inset-0 islamic-pattern opacity-30 pointer-events-none" />

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

            <div className="relative h-full px-10 py-8">
              <div className="absolute top-8 right-8 z-30">
                {isJumuahMode && (
                  <div className="rounded-full border border-amber-200/40 bg-amber-300/10 px-5 py-2 text-sm font-semibold tracking-wide text-amber-100">
                    {jumuahSlots.length} Jumuahs Today
                  </div>
                )}
              </div>
              <div className="grid h-full grid-rows-[140px_1fr_130px] gap-5">
                <div className="glass rounded-3xl px-8 py-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">Masjid</p>
                    <p className="text-3xl font-extrabold text-amber-50">{masjid.short_name || masjid.official_name}</p>
                    {masjid.city && <p className="text-white/50 text-lg">{masjid.city}</p>}
                    <p className="text-white/40 text-sm mt-1">{tz}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[88px] leading-[0.9] font-black tracking-tight text-amber-50 tick">
                      {two(clock.hour)}:{two(clock.minute)}
                      <span className="text-[34px] text-amber-100/70">:{two(clock.second)}</span>
                    </p>
                    <p className="text-white/65">{formatGregorianDate(tz)}</p>
                    <p className="text-white/45 text-sm">Hijri: {formatHijriDate(tz)}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                      {statusChipLabel}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-[34%_66%] gap-5">
                  <div className="space-y-3">
                    {PRAYER_ORDER.map((key) => {
                      const row = todayRows.find((r) => r.prayer === key);
                      if (!row) return null;
                      const isCurrentNext = nextPrayerRow?.prayer === key;
                      const isActive = activePrayer?.prayer === key;
                      const cardTone = isCurrentNext || isActive;
                      return (
                        <div
                          key={key}
                          className={`glass rounded-2xl px-5 py-4 border ${
                            cardTone
                              ? "border-emerald-300/40 bg-emerald-300/10"
                              : "border-white/10"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-2xl font-bold tracking-wide">
                              {key === "dhuhr" && isFriday ? "Dhuhr / Jumuah" : PRAYER_LABELS[key]}
                            </p>
                            <p className="text-xs uppercase text-white/60">
                              {isActive ? "active" : isCurrentNext ? "next" : "done"}
                            </p>
                          </div>
                          <div className="mt-2 flex items-end justify-between">
                            <p className="text-white/65">Adhan {formatTime(row.start_time)}</p>
                            <p className="text-4xl font-black text-amber-100"> {formatTime(row.jamaat_time)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="glass rounded-3xl p-8 border border-white/15 relative overflow-hidden">
                    <div className="absolute -right-28 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full border border-amber-200/25" />
                    <div className="absolute -right-20 top-1/2 h-56 w-56 -translate-y-1/2 rounded-full border border-emerald-200/30" />
                    <div
                      className="absolute right-8 top-8 h-44 w-44 rounded-full"
                      style={{
                        background: `conic-gradient(${ringColor} 0deg, ${ringColor} 280deg, rgba(255,255,255,0.06) 280deg 360deg)`,
                        boxShadow: "0 0 60px rgba(16,185,129,0.15)",
                      }}
                    >
                      <div className="absolute inset-[16px] rounded-full bg-slate-950/85 border border-white/10" />
                    </div>
                    {mainMode === "silent" ? (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <p className="text-5xl font-black text-amber-50">Please straighten the rows</p>
                        <p className="mt-6 text-3xl text-white/80">Silence your phones</p>
                        <p className="mt-8 text-white/50 uppercase tracking-[0.3em]">Jamaat in progress</p>
                      </div>
                    ) : mainMode === "jumuah" ? (
                      <div>
                        <p className="text-white/60 uppercase tracking-[0.3em]">Friday signature mode</p>
                        <h2 className="mt-2 text-6xl font-black text-amber-50">Jumuah Today</h2>
                        <div className="mt-8 space-y-4">
                          {jumuahSlots.map((slot) => (
                            <div key={slot.id} className="rounded-2xl border border-amber-200/25 bg-amber-300/10 px-6 py-4 flex items-center justify-between">
                              <div>
                                <p className="text-2xl font-semibold">{ordinal(slot.slot)} Jumuah</p>
                                <p className="text-white/65 text-sm">
                                  Khutbah {formatTime(slot.khutbah_time)}
                                </p>
                              </div>
                              <p className="text-4xl font-black">{formatTime(slot.jamaat_time)}</p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-6 text-white/55">Khutbah starts around 15 minutes before.</p>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col justify-center">
                        <p className="text-white/60 uppercase tracking-[0.3em]">Noor Ring mode</p>
                        <h2 className="mt-2 text-6xl font-black text-amber-50">{heroTitle}</h2>
                        <p className="mt-6 text-5xl font-black text-emerald-200">
                          {heroCountdown}
                        </p>
                        <p className="mt-4 text-2xl text-white/75">
                          Adhan {formatTime(nextPrayerRow?.start_time)} • Jamaat at {formatTime(nextPrayerRow?.jamaat_time)}
                        </p>
                        {jumuahSlots.length > 0 && (
                          <div className="mt-7 rounded-2xl border border-amber-200/15 bg-amber-200/5 px-5 py-4">
                            <p className="text-xs uppercase tracking-[0.25em] text-amber-100/80">
                              Jumuah timings
                            </p>
                            <div className="mt-3 grid grid-cols-1 gap-2">
                              {jumuahSlots.map((slot) => (
                                <div key={`daily-jumuah-${slot.id}`} className="flex items-center justify-between text-lg">
                                  <p className="text-white/85">
                                    {ordinal(slot.slot)} • Khutbah {formatTime(slot.khutbah_time)}
                                  </p>
                                  <p className="font-black text-amber-100">
                                    {formatTime(slot.jamaat_time)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {hideAnnouncementRail ? (
                  <div className="rounded-3xl px-6 py-5 flex items-center justify-center border border-white/5 bg-slate-950/40">
                    <p className="text-white/45 uppercase tracking-[0.3em]">Jamaat in progress</p>
                  </div>
                ) : (
                  <div
                    className={`glass rounded-3xl px-6 py-5 flex items-center justify-between border border-white/10 transition-opacity ${
                      deemphasizeAnnouncementRail ? "opacity-45" : "opacity-100"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em] ${
                          announcementLevel === "urgent"
                            ? "bg-amber-400/20 text-amber-100"
                            : announcementLevel === "important"
                            ? "bg-emerald-400/20 text-emerald-100"
                            : "bg-white/10 text-white/70"
                        }`}
                      >
                        {announcementLevel}
                      </span>
                      <div>
                        <p className="text-xl font-semibold">
                          {activeAnnouncement?.title || "No active announcements"}
                        </p>
                        {activeAnnouncement?.body ? (
                          <p className="text-white/60">{activeAnnouncement.body}</p>
                        ) : (
                          <p className="text-white/45">Please check back later.</p>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-white/55 mr-5">{activeAnnouncement ? "today" : "none"}</p>
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-white p-2">
                        <QRCode value={PLAY_STORE_URL} size={40} />
                      </div>
                      <div className="rounded-xl bg-white p-2">
                        <QRCode value={APPLE_STORE_URL} size={40} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
        </div>
      </div>
    </div>
  );
}
