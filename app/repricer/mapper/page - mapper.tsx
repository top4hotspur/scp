//app/repricer/mapper/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ScopeType = "SKU" | "SUPPLIER" | "PG1" | "PG2" | "PG3" | "PG4" | "PG5";

type Assignment = {
  id: string;

  // Scope selector
  scopeType: ScopeType;
  scopeValue: string; // sku OR supplier OR prodGroup value

  // Where it applies
  marketplaceId: string | "ALL";

  // Strategy link
  strategyId: string;

  // Optional per-scope overrides (profit etc)  leave null to inherit from strategy
  overrideMinProfitGbp?: number | null;
  overrideMaxPriceGbp?: number | null;

  // Automation triggers (your request)
  moveIfNoSalesDays?: number | null;     // move to another strategy
  moveIfLowStockBelow?: number | null;   // move to another strategy
  moveToStrategyId?: string | null;

  isPaused?: boolean;

  updatedAtIso: string;
};

type StrategyLite = { id: string; name: string; isEnabled: boolean };

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}
async function apiPut<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [strategies, setStrategies] = useState<StrategyLite[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  // filters
  const [q, setQ] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeType | "ALL">("ALL");
  const [marketFilter, setMarketFilter] = useState<string>("ALL");

  useEffect(() => {
    (async () => {
      try {
        const s = await apiGet<{ ok: true; strategies: StrategyLite[] }>("/api/repricer/strategies");
        setStrategies(s.strategies ?? []);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
    (async () => {
      try {
        const a = await apiGet<{ ok: true; assignments: Assignment[] }>("/api/repricer/assignments");
        setAssignments(a.assignments ?? []);
      } catch (e: any) {
        setError((prev) => prev ?? String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assignments.filter((a) => {
      if (scopeFilter !== "ALL" && a.scopeType !== scopeFilter) return false;
      if (marketFilter !== "ALL" && String(a.marketplaceId) !== marketFilter) return false;
      if (!needle) return true;
      return (
        a.scopeValue.toLowerCase().includes(needle) ||
        a.scopeType.toLowerCase().includes(needle) ||
        String(a.marketplaceId).toLowerCase().includes(needle)
      );
    });
  }, [assignments, q, scopeFilter, marketFilter]);

  const markets = useMemo(() => {
    const s = new Set<string>();
    assignments.forEach((a) => s.add(String(a.marketplaceId)));
    return ["ALL", ...Array.from(s).sort()];
  }, [assignments]);

  function addRow() {
    const now = new Date().toISOString();
    const firstStrategy = strategies.find((x) => x.isEnabled)?.id ?? strategies[0]?.id ?? "";
    const row: Assignment = {
      id: uid("asg"),
      scopeType: "SKU",
      scopeValue: "",
      marketplaceId: "ALL",
      strategyId: firstStrategy,
      overrideMinProfitGbp: null,
      overrideMaxPriceGbp: null,
      moveIfNoSalesDays: null,
      moveIfLowStockBelow: null,
      moveToStrategyId: null,
      isPaused: false,
      updatedAtIso: now,
    };
    setAssignments((p) => [row, ...p]);
  }

  function update(id: string, patch: Partial<Assignment>) {
    setAssignments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch, updatedAtIso: new Date().toISOString() } : a))
    );
  }

  function remove(id: string) {
    setAssignments((prev) => prev.filter((a) => a.id !== id));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      await apiPut("/api/repricer/assignments", { assignments });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Repricer Ã¢â‚¬Â¢ Strategy Mapper</h1>
          <p className="text-white/60">
            Map a Strategy to SKUs, Suppliers, or Product Groups (1Ã¢â‚¬â€œ5). Supports per-market overrides + automation triggers.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={addRow} className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15">
            + Add mapping
          </button>
          <button
            onClick={saveAll}
            disabled={saving || loading}
            className="rounded-xl bg-emerald-500/20 px-3 py-2 text-sm hover:bg-emerald-500/30 disabled:opacity-40"
          >
            {saving ? "SavingÃ¢â‚¬Â¦" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <div className="text-xs text-white/60">Search</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-72 rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
              placeholder="sku / supplier / pgÃ¢â‚¬Â¦"
            />
          </label>

          <label className="space-y-1">
            <div className="text-xs text-white/60">Scope</div>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as any)}
              className="w-44 rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
            >
              <option value="ALL">All</option>
              <option value="SKU">SKU</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="PG1">PG1</option>
              <option value="PG2">PG2</option>
              <option value="PG3">PG3</option>
              <option value="PG4">PG4</option>
              <option value="PG5">PG5</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-xs text-white/60">Marketplace</div>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="w-56 rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
            >
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto text-xs text-white/40">{filtered.length} mapping(s)</div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left">Scope</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Marketplace</th>
                <th className="px-3 py-2 text-left">Strategy</th>
                <th className="px-3 py-2 text-left">Overrides</th>
                <th className="px-3 py-2 text-left">Automation</th>
                <th className="px-3 py-2 text-left">Paused</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2">
                    <select
                      value={a.scopeType}
                      onChange={(e) => update(a.id, { scopeType: e.target.value as any })}
                      className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                    >
                      <option value="SKU">SKU</option>
                      <option value="SUPPLIER">Supplier</option>
                      <option value="PG1">PG1</option>
                      <option value="PG2">PG2</option>
                      <option value="PG3">PG3</option>
                      <option value="PG4">PG4</option>
                      <option value="PG5">PG5</option>
                    </select>
                  </td>

                  <td className="px-3 py-2">
                    <input
                      value={a.scopeValue}
                      onChange={(e) => update(a.id, { scopeValue: e.target.value })}
                      className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                      placeholder={a.scopeType === "SKU" ? "e.g. 4771" : "value"}
                    />
                  </td>

                  <td className="px-3 py-2">
                    <input
                      value={String(a.marketplaceId)}
                      onChange={(e) => update(a.id, { marketplaceId: e.target.value })}
                      className="w-56 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                      placeholder='ALL or "A1F83G8C2ARO7P"'
                    />
                  </td>

                  <td className="px-3 py-2">
                    <select
                      value={a.strategyId}
                      onChange={(e) => update(a.id, { strategyId: e.target.value })}
                      className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                    >
                      {strategies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.isEnabled ? "" : "(disabled)"}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-2 text-xs text-white/70">
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-2">
                        <span className="w-28 text-white/50">Min profit Ã‚£</span>
                        <input
                          type="number"
                          value={a.overrideMinProfitGbp ?? ""}
                          onChange={(e) =>
                            update(a.id, { overrideMinProfitGbp: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          className="w-24 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="w-28 text-white/50">Max price Ã‚£</span>
                        <input
                          type="number"
                          value={a.overrideMaxPriceGbp ?? ""}
                          onChange={(e) =>
                            update(a.id, { overrideMaxPriceGbp: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          className="w-24 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                        />
                      </label>
                    </div>
                  </td>

                  <td className="px-3 py-2 text-xs text-white/70">
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-2">
                        <span className="w-28 text-white/50">No sales (days)</span>
                        <input
                          type="number"
                          value={a.moveIfNoSalesDays ?? ""}
                          onChange={(e) =>
                            update(a.id, { moveIfNoSalesDays: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="w-28 text-white/50">Low stock (&lt;)</span>
                        <input
                          type="number"
                          value={a.moveIfLowStockBelow ?? ""}
                          onChange={(e) =>
                            update(a.id, { moveIfLowStockBelow: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="w-28 text-white/50">Move to</span>
                        <select
                          value={a.moveToStrategyId ?? ""}
                          onChange={(e) => update(a.id, { moveToStrategyId: e.target.value || null })}
                          className="w-40 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
                        >
                          <option value="">(none)</option>
                          {strategies.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(a.isPaused)}
                      onChange={(e) => update(a.id, { isPaused: e.target.checked })}
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(a.id)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-white/50">
                    No mappings. Click Ã¢â‚¬Å“Add mappingÃ¢â‚¬Â.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 text-xs text-white/40">
          Order of application (when the worker arrives): SKU mapping &gt; Supplier &gt; PG5Ã¢â‚¬Â¦PG1 (most specific wins), then strategy
          defaults, then assignment overrides.
        </div>
      </div>
    </div>
  );
}
