//components/cost/CostHud.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Rollup = {
  todayEstUsd: number;
  ydayActualUsd: number | null;
  top: { k: string; v: number }[];
  updatedIso: string;
};

export function CostHud() {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Rollup | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/cost/rollup", { cache: "no-store" });
        const j = (await res.json()) as Rollup;
        if (alive) setData(j);
      } catch {
        // ignore
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const lines = useMemo(() => {
    if (!data) return ["cost: (loading...)"];
    const y = data.ydayActualUsd == null ? "n/a" : data.ydayActualUsd.toFixed(2);
    const t = data.todayEstUsd.toFixed(2);
    const top = data.top
      .slice(0, 6)
      .map((x) => `${x.k.padEnd(18)} $${x.v.toFixed(2)}`);
    return [
      `SCP COST HUD`,
      `today (est)        $${t}`,
      `yesterday (actual) $${y}`,
      `updated           ${data.updatedIso}`,
      ``,
      `top drivers:`,
      ...top,
      ``,
      `toggle: click header`,
    ];
  }, [data]);

  return (
    <div className="fixed bottom-4 right-4 w-[420px] max-w-[92vw]">
      <div
        className="cursor-pointer select-none rounded-t-xl border border-white/15 bg-black/70 px-3 py-2 text-xs font-semibold backdrop-blur-xl"
        onClick={() => setOpen((v) => !v)}
      >
        Cost HUD {open ? "â–¾" : "â–¸"}
      </div>

      {open && (
        <div className="rounded-b-xl border-x border-b border-white/15 bg-black/60 p-3 font-mono text-[11px] leading-4 text-white/90 backdrop-blur-xl">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}