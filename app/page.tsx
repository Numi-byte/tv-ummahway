import { Suspense } from "react";
import TVClient from "./TVClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen noor-bg text-white">
          <div className="noise" />
          <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-10">
            <div className="glass w-full rounded-3xl p-10">
              <div className="text-xs uppercase tracking-[0.35em] text-white/60">
                UmmahWay TV
              </div>
              <div className="mt-4 text-3xl font-black">Loading…</div>
              <div className="mt-2 text-white/60">Preparing display</div>
            </div>
          </div>
        </div>
      }
    >
      <TVClient />
    </Suspense>
  );
}
