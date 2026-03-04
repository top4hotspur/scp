//app/mi/sales/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Search, LineChart } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = "today" | "yesterday" | "7d" | "30d";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

type SettingsResp = { ok: boolean; settings?: any; error?: string };
type MarketplaceOption = { value: string; label: string; isCombined?: boolean };

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// Friendly marketplace labels (fallback to id if unknown)
const MARKET_LABELS: Record<string, string> = {
  A1F83G8C2ARO7P: "United Kingdom (UK)",
  A1PA6795UKMFR9: "Germany (DE)",
  A13V1IB3VIYZZH: "France (FR)",
  APJ6JRA9NG5V4: "Italy (IT)",
  A1RKKUPIHCS9HS: "Spain (ES)",
  A1805IZSGTT6HS: "Netherlands (NL)",
  A2NODRKZP88ZB9: "Sweden (SE)",
  A1C3SOZRARQ6R3: "Poland (PL)",
  AMEN7PMS3EDWL: "Belgium (BE)",
};

function labelForMid(mid: string): string {
  return MARKET_LABELS[mid] || mid;
}

function fmtMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtDt(iso: any): string {
  const s = String(iso ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  // dd/mm/yyyy hh:mm
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function RedX() {
  return <span className="text-red-300 font-semibold">✕</span>;
}

export default function Page() {
  const [period, setPeriod] = useState<Period>("today");

  // marketplaces
  const [marketOptions, setMarketOptions] = useState<MarketplaceOption[]>([
    { value: "COMBINED", label: "Combined", isCombined: true },
  ]);
  const [market, setMarket] = useState<string>("COMBINED");

  // snapshot data
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [topSellers, setTopSellers] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  

  // collapsible sections
  const [openSales, setOpenSales] = useState(true);
  const [openTop, setOpenTop] = useState(true);
  const [openSku, setOpenSku] = useState(true);

  // SKU analysis
  const [sku, setSku] = useState("");
  const [skuDaysPreset, setSkuDaysPreset] = useState<"30" | "60" | "90" | "custom">("30");
  const [skuFrom, setSkuFrom] = useState(""); // YYYY-MM-DD
  const [skuTo, setSkuTo] = useState(""); // YYYY-MM-DD
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuErr, setSkuErr] = useState<string | null>(null);
  const [skuSeries, setSkuSeries] = useState<any[]>([]);

  // load settings to build dropdown
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/app", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as SettingsResp;
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        const s = j.settings ?? {};
        const uk = String(s.ukMarketplaceId ?? "").trim();
        const eu = safeJson<string[]>(s.euMarketplaceIdsJson ?? "[]", []);
        const mids = [uk, ...eu].filter(Boolean);

        const opts: MarketplaceOption[] = [
          { value: "COMBINED", label: "Combined", isCombined: true },
          ...mids.map((m) => ({ value: m, label: labelForMid(m) })),
        ];
        setMarketOptions(opts);

        if (!opts.some((o) => o.value === market)) setMarket("COMBINED");
      } catch (e: any) {
        console.warn("settings load failed", e?.message || e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCombined = useMemo(() => market === "COMBINED", [market]);

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    try {
      const url = isCombined
        ? `/api/sales/combined-snapshot?bucket=${encodeURIComponent(period)}`
        : `/api/sales/snapshot?mid=${encodeURIComponent(market)}&bucket=${encodeURIComponent(period)}`;

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setTopSellers(Array.isArray(json.topSellers) ? json.topSellers : []);
      
    } catch (e: any) {
      setErr(e?.message || String(e));
      setRows([]);
      setTopSellers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, period]);

  async function loadSkuAnalysis(forSku?: string) {
    const skuTrim = (forSku ?? sku).trim();
    if (!skuTrim) {
      setSkuErr("Enter a SKU.");
      setSkuSeries([]);
      return;
    }
    if (isCombined) {
      setSkuErr("SKU analysis is marketplace-only. Choose a marketplace (not Combined).");
      setSkuSeries([]);
      return;
    }

    setSkuLoading(true);
    setSkuErr(null);
    try {
      let url = `/api/sales/sku-analysis?mid=${encodeURIComponent(market)}&sku=${encodeURIComponent(skuTrim)}`;

      if (skuDaysPreset === "custom") {
        if (!skuFrom || !skuTo) throw new Error("Custom range needs From and To dates.");
        url += `&from=${encodeURIComponent(skuFrom)}&to=${encodeURIComponent(skuTo)}`;
      } else {
        url += `&days=${encodeURIComponent(skuDaysPreset)}`;
      }

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      setSku(skuTrim);
      setSkuSeries(Array.isArray(json.series) ? json.series : []);
      setOpenSku(true);
    } catch (e: any) {
      setSkuErr(e?.message || String(e));
      setSkuSeries([]);
    } finally {
      setSkuLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">MI • Sales</h1>
          <p className="text-white/60">Snapshot-first dashboard (SalesSnapshot + SalesLine drilldown).</p>
        </div>

        <button
          onClick={loadSnapshot}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/60">Marketplace</span>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="min-w-[260px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            {marketOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-xl px-3 py-2 text-sm ${
                period === p.key ? "bg-white/15 border border-white/20" : "bg-white/5 border border-white/10 hover:bg-white/10"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      ) : null}

      {/* Sales table */}
      <Section
        title="Sales"
        open={openSales}
        onToggle={() => setOpenSales((v) => !v)}
        subtitle="Image/title/ROI/margin are derived from snapshot rows. Stock remaining will be wired next."
      >
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-left">Image</th>
                <th className="py-2 pr-3 text-left">Title</th>
                <th className="py-2 pr-3 text-left">Marketplace</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-left">Date/Time</th>
                <th className="py-2 pr-3 text-right">Price</th>
                <th className="py-2 pr-3 text-right">Profit</th>
                <th className="py-2 pr-3 text-right">ROI</th>
                <th className="py-2 pr-3 text-right">Margin</th>
                <th className="py-2 text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r, idx) => {
                  const title = r.shortTitle || r.listingTitle || r.sku || "—";
                  const mid = String(r.marketplaceId ?? "");
                  const dt = r.shippedAtIso || r.purchaseAtIso || null;

                  const missing = Boolean(r.missingCostFields);
                  const price = fmtMoney(r.revenueExVat ?? r.price ?? r.itemPrice);
                  const profit = missing ? null : fmtMoney(r.profitExVat);
                  const roi = missing ? null : fmtPct(r.roiPct);
                  const margin = missing ? null : fmtPct(r.marginPct);

                  return (
                    <tr key={`${r.sku ?? idx}-${idx}`} className="border-b border-white/5">
                      <td className="py-2 pr-3">
                        {r.imageUrl ? (
                          <img
                            src={r.imageUrl}
                            alt=""
                            className="h-10 w-10 rounded-lg object-cover border border-white/10"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg border border-white/10 bg-white/5" />
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{title}</div>
                        <div className="text-xs text-white/60">{r.sku}</div>
                      </td>
                      <td className="py-2 pr-3">{labelForMid(mid)}</td>
                      <td className="py-2 pr-3 text-right">{r.qty ?? "—"}</td>
                      <td className="py-2 pr-3">{fmtDt(dt)}</td>
                      <td className="py-2 pr-3 text-right">{price}</td>
                      <td className="py-2 pr-3 text-right">{missing ? <RedX /> : profit}</td>
                      <td className="py-2 pr-3 text-right">{missing ? <RedX /> : roi}</td>
                      <td className="py-2 pr-3 text-right">{missing ? <RedX /> : margin}</td>
                      <td className="py-2 text-right">
  {Number.isFinite(Number(r.stockAvailable)) ? Number(r.stockAvailable) : <span className="text-white/60">—</span>}
</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-white/60">
                    No rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Top sellers table */}
      <Section title="Top 10 sellers" open={openTop} onToggle={() => setOpenTop((v) => !v)}>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-left">SKU</th>
                <th className="py-2 pr-3 text-right">Units</th>
                <th className="py-2 pr-3 text-right">Profit</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {topSellers.length ? (
                topSellers.map((t, idx) => (
                  <tr key={`${t.sku ?? idx}-${idx}`} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-medium">{t.sku ?? "—"}</td>
                    <td className="py-2 pr-3 text-right">{t.units ?? "—"}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(t.profit)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => loadSkuAnalysis(String(t.sku ?? ""))}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                        title="Sales Price Analysis"
                      >
                        <LineChart className="h-4 w-4" />
                        Price Analysis
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-white/60">
                    No rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* SKU analysis */}
      <Section
        title="SKU Price & Profit analysis"
        open={openSku}
        onToggle={() => setOpenSku((v) => !v)}
        subtitle="Marketplace-only. Uses stored SalesLine. Combined is disabled for this."
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <div className="text-xs text-white/60">SKU</div>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. LP42495"
              className="w-[240px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <PresetButton label="30d" active={skuDaysPreset === "30"} onClick={() => setSkuDaysPreset("30")} />
            <PresetButton label="60d" active={skuDaysPreset === "60"} onClick={() => setSkuDaysPreset("60")} />
            <PresetButton label="90d" active={skuDaysPreset === "90"} onClick={() => setSkuDaysPreset("90")} />
            <PresetButton label="Custom" active={skuDaysPreset === "custom"} onClick={() => setSkuDaysPreset("custom")} />
          </div>

          {skuDaysPreset === "custom" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <div className="text-xs text-white/60">From</div>
                <input
                  type="date"
                  value={skuFrom}
                  onChange={(e) => setSkuFrom(e.target.value)}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs text-white/60">To</div>
                <input
                  type="date"
                  value={skuTo}
                  onChange={(e) => setSkuTo(e.target.value)}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
          ) : null}

          <button
            onClick={() => loadSkuAnalysis()}
            disabled={skuLoading}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            <Search className={skuLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Run
          </button>
        </div>

        {skuErr ? (
          <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{skuErr}</div>
        ) : null}

        <div className="mt-4 h-[320px] rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-white/60 mb-2">
            Chart: Sale price + profit per line. Each bar is one sale line.
          </div>

          {skuSeries.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={skuSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="price" stackId="a" name="Price" />
                <Bar dataKey="profit" stackId="a" name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-white/60">No data yet.</div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section(props: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{props.title}</div>
          {props.subtitle ? <div className="text-xs text-white/60">{props.subtitle}</div> : null}
        </div>
        <button
          onClick={props.onToggle}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          title={props.open ? "Collapse" : "Expand"}
        >
          {props.open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {props.open ? <div className="mt-3">{props.children}</div> : null}
    </div>
  );
}

function PresetButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`rounded-xl px-3 py-2 text-sm ${
        props.active ? "bg-white/15 border border-white/20" : "bg-white/5 border border-white/10 hover:bg-white/10"
      }`}
    >
      {props.label}
    </button>
  );
}