"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Optional QR
// import QRCode from "qrcode.react";

type Masjid = {
  id: string;
  official_name: string;
  city: string | null;
  timezone: string | null;
};

type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

type PrayerRow = {
  prayer: PrayerKey;
  start_time: string;  // "HH:MM:SS"
  jamaat_time: string; // "HH:MM:SS"
  date: string;        // "YYYY-MM-DD"
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

type SlideKey = "board" | "announcements";

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

function formatTimeHHMM(time: string) {
  // "HH:MM:SS" -> "HH:MM"
  return time?.slice(0, 5) ?? "—";
}

function nowInTimeZone(tz: string | null) {
  // Uses Intl to “simulate” local time in a tz
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

function ymdFromTZ(tz: string | null) {
  const n = nowInTimeZone(tz);
  return `${n.year}-${two(n.month)}-${two(n.day)}`;
}

function computeNextPrayer(prayers: PrayerRow[], tz: string | null) {
  const n = nowInTimeZone(tz);
  const today = `${n.year}-${two(n.month)}-${two(n.day)}`;
  const minutesNow = n.hour * 60 + n.minute;

  const todayRows = prayers.filter((p) => p.date === today);

  // next based on jamaat time (better for TV)
  for (const key of PRAYER_ORDER) {
    const row = todayRows.find((r) => r.prayer === key);
    if (!row) continue;
    const [hh, mm] = row.jamaat_time.slice(0, 5).split(":").map(Number);
    const mins = hh * 60 + mm;
    if (mins >= minutesNow) return { prayer: key, mins };
  }
  // fallback: first prayer
  const first = todayRows.find((r) => r.prayer === "fajr") ?? null;
  if (first) {
    const [hh, mm] = first.jamaat_time.slice(0, 5).split(":").map(Number);
    return { prayer: "fajr" as PrayerKey, mins: hh * 60 + mm };
  }
  return null;
}

function msUntilNextSecond() {
  const now = new Date();
  return 1000 - now.getMilliseconds();
}

/** Fullscreen helpers */
function canFullscreen() {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
}
async function enterFullscreen() {
  try {
    if (!canFullscreen()) return;
    if (document.fullscreenElement) return;
    await document.documentElement.requestFullscreen();
  } catch {
    // ignore
  }
}
async function exitFullscreen() {
  try {
    if (!document.fullscreenElement) return;
    await document.exitFullscreen();
  } catch {
    // ignore
  }
}

export default function TVClient() {
  const sp = useSearchParams();

  const masjidId = sp.get("masjid"); // UUID is the truth ✅
  const cycleSec = Math.max(8, Number(sp.get("cycle") ?? 14)); // per-slide seconds
  const tzOverride = sp.get("tz"); // optional override

  const alive = useRef(true);

  const [masjid, setMasjid] = useState<Masjid | null>(null);
  const [prayers, setPrayers] = useState<PrayerRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const [clock, setClock] = useState(() => nowInTimeZone("Europe/Rome"));
  const tz = tzOverride || masjid?.timezone || "Europe/Rome";

  const [slide, setSlide] = useState<SlideKey>("board");
  const [slideProgress, setSlideProgress] = useState(0);

  const [fullscreenPrompt, setFullscreenPrompt] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track fullscreen state
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    onFs();
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Global key handlers (TV remote often maps OK/Enter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key.toLowerCase() === "f") {
        enterFullscreen().then(() => setFullscreenPrompt(false));
      }
      if (e.key === "Escape") {
        exitFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Smooth clock in masjid timezone
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const tick = () => {
      setClock(nowInTimeZone(tz));
      timer = setTimeout(tick, msUntilNextSecond());
    };

    timer = setTimeout(tick, msUntilNextSecond());
    return () => clearTimeout(timer);
  }, [tz]);

  // Load masjid + data
  async function loadAll(mId: string) {
    // Masjid
    const { data: m, error: mErr } = await supabase
      .from("public_masjids")
      .select("id, official_name, city, timezone")
      .eq("id", mId)
      .maybeSingle();

    if (mErr || !m) throw new Error("Masjid not found or not public.");
    if (!alive.current) return;

    setMasjid(m as Masjid);

    const today = ymdFromTZ(m.timezone);

    // Prayer times (today)
    const { data: p, error: pErr } = await supabase
      .from("masjid_prayer_times")
      .select("prayer, start_time, jamaat_time, date")
      .eq("masjid_id", mId)
      .eq("date", today)
      .order("prayer", { ascending: true });

    if (!alive.current) return;
    if (pErr) setPrayers([]);
    else setPrayers((p ?? []) as PrayerRow[]);

    // Announcements (active)
    const { data: a, error: aErr } = await supabase
      .from("masjid_announcements")
      .select("id, title, body, category, is_pinned, starts_at, ends_at, created_at")
      .eq("masjid_id", mId)
      .or("starts_at.is.null,starts_at.lte.now()")
      .or("ends_at.is.null,ends_at.gte.now()")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (!alive.current) return;
    if (aErr) setAnnouncements([]);
    else setAnnouncements((a ?? []) as AnnouncementRow[]);
  }

  // Boot
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
  }, [masjidId]);

  // Realtime refresh (prayers + announcements)
  useEffect(() => {
    if (!masjidId) return;

    const channel = supabase
      .channel(`tv:${masjidId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "masjid_prayer_times", filter: `masjid_id=eq.${masjidId}` },
        async () => {
          try { await loadAll(masjidId); } catch {}
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "masjid_announcements", filter: `masjid_id=eq.${masjidId}` },
        async () => {
          try { await loadAll(masjidId); } catch {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masjidId]);

  // Slideshow
  useEffect(() => {
    const slides: SlideKey[] = announcements.length > 0 ? ["board", "announcements"] : ["board"];
    let i = 0;
    setSlide(slides[0]);
    setSlideProgress(0);

    const start = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - start) / 1000;
      const prog = (elapsed % cycleSec) / cycleSec;
      setSlideProgress(prog);
    };

    const progressTimer = setInterval(tick, 100);

    const timer = setInterval(() => {
      i = (i + 1) % slides.length;
      setSlide(slides[i]);
    }, cycleSec * 1000);

    return () => {
      clearInterval(timer);
      clearInterval(progressTimer);
    };
  }, [cycleSec, announcements.length]);

  const next = useMemo(() => computeNextPrayer(prayers, tz), [prayers, tz]);
  const nextLabel = next ? PRAYER_LABEL[next.prayer] : "—";

  // Countdown
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

  // UI states
  if (bootError) {
    return (
      <div className="relative min-h-screen noor-bg text-white">
        <div className="noise" />
        <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-10">
          <div className="glass w-full rounded-3xl p-10">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay TV</div>
            <div className="mt-4 text-3xl font-black">Could not load display</div>
            <div className="mt-4 text-white/70">{bootError}</div>
            <div className="mt-6 text-sm text-white/40">
              Example URL: <span className="font-mono">/ ?masjid=&lt;UUID&gt;</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!masjid) {
    return (
      <div className="relative min-h-screen noor-bg text-white">
        <div className="noise" />
        <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-10">
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
      className="relative h-screen w-screen overflow-hidden text-white"
      onClick={() => {
        // click/OK once -> fullscreen
        if (!isFullscreen) {
          enterFullscreen().then(() => setFullscreenPrompt(false));
        } else {
          setFullscreenPrompt(false);
        }
      }}
    >
      <div className="absolute inset-0 noor-bg" />
      <div className="noise" />

      {/* Top-right fullscreen button */}
      <div className="absolute right-6 top-6 z-20">
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

      {/* Fullscreen prompt overlay (TV-friendly) */}
      {fullscreenPrompt && !isFullscreen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-10">
          <div className="glass w-full max-w-4xl rounded-3xl p-12 text-center">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">UmmahWay TV</div>
            <div className="mt-5 text-5xl font-black">Press OK to go Fullscreen</div>
            <div className="mt-4 text-xl text-white/70">
              Click / press Enter once. After that, the display runs hands-free.
            </div>
            <div className="mt-8 text-sm text-white/40">
              Tip: On most remotes, OK = click.
            </div>
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

      {/* Slide progress bar */}
      <div className="absolute left-0 top-0 z-10 h-1 w-full bg-white/10">
        <div
          className="h-full bg-emerald-400 transition-[width]"
          style={{ width: `${Math.round(slideProgress * 100)}%` }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex h-full w-full flex-col p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-8">
          <div className="glass rounded-3xl px-8 py-6">
            <div className="text-xs uppercase tracking-[0.35em] text-white/60">
              Prayer Times • Jamaat • Announcements
            </div>
            <div className="mt-3 text-5xl font-black leading-tight">{title}</div>
            {place && <div className="mt-2 text-2xl text-white/70">{place}</div>}
          </div>

          <div className="glass rounded-3xl px-8 py-6 text-right">
            <div className="text-sm uppercase tracking-[0.32em] text-white/60">
              {clock.weekday} • {two(clock.day)}/{two(clock.month)}/{clock.year}
            </div>
            <div className="tick mt-3 text-6xl font-black">
              {two(clock.hour)}:{two(clock.minute)}
              <span className="text-white/40">:{two(clock.second)}</span>
            </div>
            <div className="mt-3 text-xl text-white/70">
              Next: <span className="font-black text-white">{nextLabel}</span>{" "}
              <span className="text-white/50">in</span>{" "}
              <span className="font-black text-emerald-300">{countdown}</span>
            </div>
          </div>
        </div>

        {/* Slides */}
        <div className="mt-8 flex flex-1 gap-8">
          {slide === "board" ? (
            <>
              {/* Prayer panel */}
              <div className="glass w-[58%] rounded-3xl p-8">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.35em] text-white/60">Today</div>
                    <div className="mt-2 text-3xl font-black">Prayer Schedule</div>
                  </div>
                  <div className="text-lg text-white/60">
                    Times are local <span className="font-black text-white/80">{tz}</span>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-3 gap-4 text-white/85">
                  <div className="text-lg font-extrabold text-white/55 uppercase tracking-widest">Prayer</div>
                  <div className="text-lg font-extrabold text-white/55 uppercase tracking-widest text-center">Start</div>
                  <div className="text-lg font-extrabold text-white/55 uppercase tracking-widest text-right">Jamaat</div>

                  {PRAYER_ORDER.map((k) => {
                    const row = prayers.find((p) => p.prayer === k);
                    const isNext = next?.prayer === k;

                    return (
                      <React.Fragment key={k}>
                        <div
                          className={[
                            "rounded-2xl px-4 py-5 text-3xl font-black",
                            isNext ? "bg-emerald-400 text-emerald-950" : "bg-white/5",
                          ].join(" ")}
                        >
                          {PRAYER_LABEL[k]}
                        </div>
                        <div
                          className={[
                            "rounded-2xl px-4 py-5 text-center text-3xl font-black tick",
                            isNext ? "bg-emerald-400 text-emerald-950" : "bg-white/5",
                          ].join(" ")}
                        >
                          {row ? formatTimeHHMM(row.start_time) : "—"}
                        </div>
                        <div
                          className={[
                            "rounded-2xl px-4 py-5 text-right text-3xl font-black tick",
                            isNext ? "bg-emerald-400 text-emerald-950" : "bg-white/5",
                          ].join(" ")}
                        >
                          {row ? formatTimeHHMM(row.jamaat_time) : "—"}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Footer hint (optional) */}
                <div className="mt-8 text-sm text-white/45">
                  Update instantly from admin — TVs refresh automatically.
                </div>
              </div>

              {/* Announcements preview */}
              <div className="glass w-[42%] rounded-3xl p-8">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.35em] text-white/60">Now</div>
                    <div className="mt-2 text-3xl font-black">Announcements</div>
                  </div>
                  <div className="text-lg text-white/60">
                    {announcements.length} items
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {announcements.slice(0, 5).map((a) => (
                    <div key={a.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-2xl font-black leading-tight">{a.title}</div>
                        {a.is_pinned && (
                          <div className="rounded-full bg-amber-300/20 px-4 py-2 text-sm font-black text-amber-200">
                            PINNED
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-lg leading-7 text-white/70 line-clamp-3">
                        {a.body}
                      </div>
                    </div>
                  ))}

                  {announcements.length === 0 && (
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-xl text-white/60">
                      No announcements right now.
                    </div>
                  )}
                </div>

                <div className="mt-6 text-sm text-white/45">
                  Full list rotates on the next slide.
                </div>
              </div>
            </>
          ) : (
            // Full announcements slide (big text)
            <div className="glass w-full rounded-3xl p-10">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.35em] text-white/60">Important</div>
                  <div className="mt-2 text-4xl font-black">Announcements</div>
                </div>

                {/* Optional QR for admin / info page */}
                {/* <div className="rounded-3xl bg-white p-4">
                  <QRCode value={`https://ummahway.com/admin`} size={110} />
                </div> */}
              </div>

              <div className="mt-8 grid grid-cols-2 gap-6">
                {announcements.slice(0, 8).map((a) => (
                  <div
                    key={a.id}
                    className={[
                      "rounded-3xl border p-7",
                      a.is_pinned
                        ? "border-amber-300/30 bg-amber-200/10"
                        : "border-white/10 bg-white/5",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-3xl font-black leading-tight">{a.title}</div>
                      {a.is_pinned && (
                        <div className="rounded-full bg-amber-300/20 px-4 py-2 text-sm font-black text-amber-200">
                          PINNED
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-xl leading-8 text-white/75">
                      {a.body}
                    </div>
                  </div>
                ))}

                {announcements.length === 0 && (
                  <div className="col-span-2 rounded-3xl border border-white/10 bg-white/5 p-10 text-2xl text-white/60">
                    No announcements right now.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom ticker (optional) */}
        <div className="mt-6 glass rounded-3xl px-8 py-5">
          <div className="flex items-center gap-6">
            <div className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-black text-emerald-950">
              LIVE
            </div>
            <div className="marquee flex-1 text-xl text-white/80">
              <div>
                {announcements.length
                  ? announcements.map((a) => `• ${a.title}`).join("   ")
                  : "• Welcome • Prayer times update automatically •"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
