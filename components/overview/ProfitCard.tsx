//components/overview/ProfitCard.tsx
"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

function gbp(v: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(v || 0);
}

export default function ProfitCard({
  title,
  value,
  salesTotal,
  deltaPct,
}: {
  title: string;
  value: number;
  salesTotal: number;
  deltaPct: number | null;
}) {
  const up = (deltaPct ?? 0) >= 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-lg backdrop-blur min-h-[110px] w-full">
      <div className="text-[11px] uppercase tracking-wide text-white/60">{title}</div>

      <div className="mt-2 text-2xl font-semibold text-white">{gbp(value)}</div>

      <div className="mt-1 text-sm text-white/45">
        From sales total of {gbp(salesTotal)}
      </div>

            {deltaPct === null ? (
        <div className="mt-3 h-5" />
      ) : (
        <div
          className={`mt-3 inline-flex items-center gap-1 text-sm ${
            up ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          <span>{Math.abs(deltaPct).toFixed(1)}%</span>
          <span className="text-white/40">vs previous period</span>
        </div>
      )}
    </div>
  );
}