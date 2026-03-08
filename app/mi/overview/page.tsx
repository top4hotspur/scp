"use client";

import { useEffect, useState } from "react";

type Bucket = "today" | "yesterday" | "7d" | "30d";

type Totals = {
  rows?: number;
  rowsWithCompleteCosts?: number;
  units?: number;
  profitExVat?: number;
};

type Snap = {
  rows: any[];
  totals: Totals;
  error?: string;
};

function fmtMoney(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";
}

function fmtInt(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : "—";
}

async function loadBucket(bucket: Bucket): Promise<Snap> {
  const res = await fetch(`/api/sales/combined-snapshot?bucket=${encodeURIComponent(bucket)}&fresh=1`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) return { rows: [], totals: {}, error: json?.error ?? `HTTP ${res.status}` };
  return {
    rows: Array.isArray(json.rows) ? json.rows : [],
    totals: (json.totals ?? {}) as Totals,
  };
}

export default function OverviewPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [today, setToday] = useState<Snap>({ rows: [], totals: {} });
  const [yesterday, setYesterday] = useState<Snap>({ rows: [], totals: {} });
  const [d7, setD7] = useState<Snap>({ rows: [], totals: {} });
  const [d30, setD30] = useState<Snap>({ rows: [], totals: {} });

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [a, b, c, d] = await Promise.all([
        loadBucket("today"),
        loadBucket("yesterday"),
        loadBucket("7d"),
        loadBucket("30d"),
      ]);
      setToday(a);
      setYesterday(b);
      setD7(c);
      setD30(d);
      const e = a.error || b.error || c.error || d.error;
      if (e) setErr(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const last10 = today.rows.slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Overview</h1>
          <p className="text-white/60">Snapshot-first MI dashboard (fee-aware, cost-complete rows only for profit totals).</p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh Overview Snapshot"}
        </button>
      </div>

      {err ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Profit Today" totals={today.totals} />
        <Card title="Profit Yesterday" totals={yesterday.totals} />
        <Card title="Profit Last 7 Days" totals={d7.totals} />
        <Card title="Profit Last 30 Days" totals={d30.totals} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-semibold">Last 10 Sales (Today bucket)</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-left">SKU / Product</th>
                <th className="py-2 pr-3 text-right">Costs complete</th>
                <th className="py-2 pr-3 text-right">Selling Price</th>
                <th className="py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {last10.length ? (
                last10.map((r, i) => (
                  <tr key={`${r.sku ?? i}-${i}`} className="border-b border-white/5">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.sku ?? "—"}</div>
                      <div className="text-white/60">{r.shortTitle ?? r.listingTitle ?? "—"}</div>
                    </td>
                    <td className="py-2 pr-3 text-right">{r.missingCostFields ? "No" : "Yes"}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(r.revenueExVat)}</td>
                    <td className="py-2 text-right text-emerald-300">{r.missingCostFields ? "—" : fmtMoney(r.profitExVat)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-white/60">No rows yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ title, totals }: { title: string; totals: Totals }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-white/60">{title}</div>
      <div className="text-4xl font-semibold">{fmtMoney(totals.profitExVat)}</div>
      <div className="mt-1 text-white/60">{fmtInt(totals.rowsWithCompleteCosts)} / {fmtInt(totals.rows)} rows cost-complete.</div>
    </div>
  );
}
