"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Masjid = {
  id: string;
  slug: string | null;
  official_name: string;
  city: string | null;
};

type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
type PrayerRow = {
  prayer: PrayerKey;
  start_time: string; // "HH:MM:SS"
  jamaat_time: string; // "HH:MM:SS"
};

type Announcement = {
  id: number;
  title: string;
  body: string;
  category: string;
  is_pinned: boolean;
};

const PRAYER_ORDER: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

function hhmm(t?: string | null) {
  if (!t) return "—";
  return t.slice(0, 5);
}

function todayISO() {
  const d = new Date();
  // local date (good for “today” display)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getParam(name: string) {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && v.trim().length ? v.trim() : null;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = useMemo(() => {
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }, [now]);
  const date = useMemo(() => {
    return now.toLocaleDateString("it-IT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }, [now]);
  return { now, time, date };
}

export default function TvHome() {
  const { time, date } = useClock();

  const [bootError, setBootError] = useState<string | null>(null);
  const [masjid, setMasjid] = useState<Masjid | null>(null);

  const [prayers, setPrayers] = useState<Record<PrayerKey, PrayerRow | null>>({
    fajr: null,
    dhuhr: null,
    asr: null,
    maghrib: null,
    isha: null,
  });

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // slideshow config (can later come from masjid_tv_settings)
  const [slideSeconds, setSlideSeconds] = useState<number>(10);

  const [slideIndex, setSlideIndex] = useState<number>(0);
  const slides = useMemo(() => ["prayers", "announcements", "clock"] as const, []);

  const aliveRef = useRef(true);

  // 1) Resolve masjid (uuid or slug)
  useEffect(() => {
    aliveRef.current = true;

    const run = async () => {
      setBootError(null);

      const masjidId = getParam("masjid");
      const slug = getParam("slug");

      if (!masjidId && !slug) {
        setBootError(
          "Missing masjid. Use: ?masjid=<uuid> OR ?slug=<slug> (example: tv.ummahway.com?slug=bolzano)"
        );
        return;
      }

      try {
        const q = supabase
          .from("public_masjids")
          .select("id, slug, official_name, city")
          .limit(1);

        const { data, error } = masjidId
          ? await q.eq("id", masjidId).maybeSingle()
          : await q.eq("slug", slug!).maybeSingle();

        if (error || !data) {
          setBootError("Masjid not found or not public.");
          return;
        }

        if (!aliveRef.current) return;
        setMasjid(data as Masjid);
      } catch {
        setBootError("Could not connect to backend.");
      }
    };

    void run();

    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 2) Load prayers + announcements for today
  useEffect(() => {
    if (!masjid?.id) return;

    const loadAll = async () => {
      const iso = todayISO();

      // prayers
      const { data: pData } = await supabase
        .from("masjid_prayer_times")
        .select("prayer, start_time, jamaat_time")
        .eq("masjid_id", masjid.id)
        .eq("date", iso);

      const map: Record<PrayerKey, PrayerRow | null> = {
        fajr: null,
        dhuhr: null,
        asr: null,
        maghrib: null,
        isha: null,
      };

      (pData as PrayerRow[] | null)?.forEach((r) => {
        map[r.prayer as PrayerKey] = r;
      });
      setPrayers(map);

      // announcements (active view)
      const { data: aData } = await supabase
        .from("masjid_announcements_active")
        .select("id, title, body, category, is_pinned")
        .eq("masjid_id", masjid.id)
        .limit(25);

      setAnnouncements(((aData ?? []) as Announcement[]).sort((a, b) => {
        if (a.is_pinned === b.is_pinned) return b.id - a.id;
        return a.is_pinned ? -1 : 1;
      }));
    };

    void loadAll();
  }, [masjid?.id]);

  // 3) Realtime subscriptions
  useEffect(() => {
    if (!masjid?.id) return;

    const channel = supabase
      .channel(`tv-${masjid.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "masjid_prayer_times",
          filter: `masjid_id=eq.${masjid.id}`,
        },
        async () => {
          // refresh only prayers today
          const iso = todayISO();
          const { data } = await supabase
            .from("masjid_prayer_times")
            .select("prayer, start_time, jamaat_time")
            .eq("masjid_id", masjid.id)
            .eq("date", iso);

          const map: Record<PrayerKey, PrayerRow | null> = {
            fajr: null,
            dhuhr: null,
            asr: null,
            maghrib: null,
            isha: null,
          };
          (data as PrayerRow[] | null)?.forEach((r) => {
            map[r.prayer as PrayerKey] = r;
          });
          setPrayers(map);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "masjid_announcements",
          filter: `masjid_id=eq.${masjid.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("masjid_announcements_active")
            .select("id, title, body, category, is_pinned")
            .eq("masjid_id", masjid.id)
            .limit(25);

          setAnnouncements(((data ?? []) as Announcement[]).sort((a, b) => {
            if (a.is_pinned === b.is_pinned) return b.id - a.id;
            return a.is_pinned ? -1 : 1;
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [masjid?.id]);

  // 4) Slideshow loop
  useEffect(() => {
    const id = setInterval(() => {
      setSlideIndex((i) => (i + 1) % slides.length);
    }, Math.max(4, slideSeconds) * 1000);

    return () => clearInterval(id);
  }, [slideSeconds, slides.length]);

  const currentSlide = slides[slideIndex];

  if (bootError) {
    return (
      <div className="relative h-screen w-screen overflow-hidden text-white">
        <div className="absolute inset-0 noor-beams noise" />
        <div className="relative z-10 flex h-full w-full items-center justify-center p-10">
          <div className="glass panel w-full max-w-4xl p-10">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <div className="text-sm uppercase tracking-[0.35em] text-white/70">
                UmmahWay TV
              </div>
            </div>
            <h1 className="mt-5 text-4xl font-black leading-tight">
              TV display not configured
            </h1>
            <p className="mt-4 text-lg text-white/70">{bootError}</p>
            <p className="mt-6 text-white/50">
              Example: <span className="text-white/80">tv.ummahway.com?slug=bolzano</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!masjid) {
    return (
      <div className="relative h-screen w-screen overflow-hidden text-white">
        <div className="absolute inset-0 noor-beams noise" />
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <div className="glass panel px-10 py-8">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400 pulseDot" />
              <div className="text-sm uppercase tracking-[0.35em] text-white/70">
                Loading masjid…
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden text-white">
      {/* Background */}
      <div className="absolute inset-0 noor-beams noise" />

      {/* Top chrome */}
      <div className="relative z-10 flex h-full w-full flex-col p-10">
        <div className="flex items-start justify-between gap-8">
          <div className="glass panel px-8 py-6">
            <div className="text-xs uppercase tracking-[0.38em] text-white/60">
              UmmahWay • Masjid Display
            </div>
            <div className="mt-3 text-4xl font-black leading-tight">
              {masjid.official_name}
            </div>
            <div className="mt-2 text-lg text-white/70">
              {masjid.city ?? "—"} • {date}
            </div>
          </div>

          <div className="glass panel px-8 py-6 text-right">
            <div className="text-xs uppercase tracking-[0.38em] text-white/60">
              Live Time
            </div>
            <div className="mt-2 text-6xl font-black tabular-nums">
              {time}
            </div>
            <div className="mt-3 flex items-center justify-end gap-3 text-white/70">
              <span className="h-3 w-3 rounded-full bg-emerald-400 pulseDot" />
              <span className="text-sm uppercase tracking-[0.28em]">
                auto-updating
              </span>
            </div>
          </div>
        </div>

        {/* Main stage */}
        <div className="mt-8 grid flex-1 grid-cols-12 gap-8">
          <div className="col-span-8 glass panel p-10">
            {currentSlide === "prayers" && (
              <PrayersSlide prayers={prayers} />
            )}
            {currentSlide === "announcements" && (
              <AnnouncementsSlide announcements={announcements} />
            )}
            {currentSlide === "clock" && (
              <ClockSlide time={time} date={date} />
            )}
          </div>

          {/* Right rail: fixed “now / next” feel */}
          <div className="col-span-4 flex flex-col gap-8">
            <div className="glass panel p-8">
              <div className="text-xs uppercase tracking-[0.35em] text-white/60">
                Slide
              </div>
              <div className="mt-3 text-2xl font-extrabold">
                {currentSlide === "prayers"
                  ? "Prayer Times"
                  : currentSlide === "announcements"
                  ? "Announcements"
                  : "Clock & Date"}
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                {["prayers", "announcements", "clock"].map((k, idx) => {
                  const active = idx === slideIndex;
                  return (
                    <button
                      key={k}
                      className={`rounded-2xl border px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.25em] ${
                        active
                          ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-white/5 text-white/60"
                      }`}
                      onClick={() => setSlideIndex(idx)}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 text-sm text-white/60">
                Rotation:{" "}
                <span className="text-white/80 font-semibold">
                  {slideSeconds}s
                </span>
              </div>

              <div className="mt-3 flex gap-3">
                <button
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10"
                  onClick={() => setSlideSeconds((s) => Math.max(4, s - 2))}
                >
                  −
                </button>
                <button
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10"
                  onClick={() => setSlideSeconds((s) => Math.min(30, s + 2))}
                >
                  +
                </button>
              </div>
            </div>

            <div className="glass panel p-8">
              <div className="text-xs uppercase tracking-[0.35em] text-white/60">
                Quick Tip
              </div>
              <div className="mt-3 text-white/75 leading-relaxed">
                Use a kiosk browser on the TV device and open:
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white/80">
                  tv.ummahway.com?slug={masjid.slug ?? "your-slug"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom footer */}
        <div className="mt-8 flex items-center justify-between text-white/40">
          <div className="text-xs uppercase tracking-[0.30em]">
            Powered by UmmahWay • Supabase Realtime
          </div>
          <div className="text-xs uppercase tracking-[0.30em]">
            Masjid: {masjid.id}
          </div>
        </div>
      </div>
    </div>
  );
}

function PrayersSlide({
  prayers,
}: {
  prayers: Record<PrayerKey, PrayerRow | null>;
}) {
  return (
    <div className="h-full">
      <div className="text-xs uppercase tracking-[0.35em] text-white/60">
        Today’s Prayer Times
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {PRAYER_ORDER.map((k) => {
          const row = prayers[k];
          const label = k.toUpperCase();
          return (
            <div
              key={k}
              className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-8 py-6"
            >
              <div>
                <div className="text-2xl font-black tracking-wide">{label}</div>
                <div className="mt-2 text-sm uppercase tracking-[0.30em] text-white/50">
                  start • jamaat
                </div>
              </div>

              <div className="text-right">
                <div className="text-4xl font-black tabular-nums text-emerald-100">
                  {hhmm(row?.jamaat_time)}
                </div>
                <div className="mt-2 text-lg tabular-nums text-white/65">
                  {hhmm(row?.start_time)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnnouncementsSlide({ announcements }: { announcements: Announcement[] }) {
  return (
    <div className="h-full">
      <div className="text-xs uppercase tracking-[0.35em] text-white/60">
        Announcements
      </div>

      {announcements.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-10 text-white/70">
          <div className="text-2xl font-extrabold">No announcements right now</div>
          <div className="mt-3 text-white/60">
            Admin updates will appear here automatically.
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {announcements.slice(0, 6).map((a) => (
            <div
              key={a.id}
              className={`rounded-3xl border p-8 ${
                a.is_pinned
                  ? "border-emerald-400/30 bg-emerald-400/10"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-6">
                <div className="text-2xl font-black">{a.title}</div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.30em] text-white/70">
                  {a.category}
                </div>
              </div>
              <div className="mt-4 text-lg leading-relaxed text-white/75">
                {a.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClockSlide({ time, date }: { time: string; date: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <div className="text-xs uppercase tracking-[0.35em] text-white/60">
        Live
      </div>
      <div className="mt-6 text-[120px] leading-none font-black tabular-nums">
        {time}
      </div>
      <div className="mt-6 text-2xl text-white/70">{date}</div>

      <div className="mt-10 rounded-3xl border border-white/10 bg-white/5 px-10 py-6 text-white/70">
        Tip: set your TV to auto-open this page in kiosk mode.
      </div>
    </div>
  );
}
