//app/repricer/status/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type StrategyLite = { id: string; name: string; isEnabled: boolean; updatedAtIso?: string };
type AssignmentLite = { id: string; scopeType: string; scopeValue: string; marketplaceId: string; strategyId: string; isPaused?: boolean };

async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyLite[]>([]);
  const [assignments, setAssignments] = useState<AssignmentLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const s = await apiGet<{ ok: true; strategies: StrategyLite[] }>("/api/repricer/strategies");
        const a = await apiGet<{ ok: true; assignments: AssignmentLite[] }>("/api/repricer/assignments");
        setStrategies(s.strategies ?? []);
        setAssignments(a.assignments ?? []);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stratById = useMemo(() => new Map(strategies.map((s) => [s.id, s])), [strategies]);

  const kpis = useMemo(() => {
    const enabled = strategies.filter((s) => s.isEnabled).length;
    const pausedMaps = assignments.filter((a) => a.isPaused).length;
    const byMarket = new Map<string, number>();
    for (const a of assignments) byMarket.set(String(a.marketplaceId), (byMarket.get(String(a.marketplaceId)) ?? 0) + 1);
    return { enabled, pausedMaps, markets: byMarket.size, totalMaps: assignments.length };
  }, [strategies, assignments]);

  const topMappings = useMemo(() => assignments.slice(0, 25), [assignments]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Repricer â€¢ Status</h1>
        <p className="text-white/60">
          Operational view. This will become the â€œprice pilotâ€ dashboard (Buy Box climb + velocity guard backoff events).
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="text-xs text-white/50">Enabled strategies</div>
          <div className="mt-1 text-2xl font-semibold">{kpis.enabled}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="text-xs text-white/50">Mappings</div>
          <div className="mt-1 text-2xl font-semibold">{kpis.totalMaps}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="text-xs text-white/50">Paused mappings</div>
          <div className="mt-1 text-2xl font-semibold">{kpis.pausedMaps}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="text-xs text-white/50">Marketplaces with mappings</div>
          <div className="mt-1 text-2xl font-semibold">{kpis.markets}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="mb-2 text-sm font-medium">Strategies</div>
          <div className="space-y-2">
            {strategies.map((s) => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.name}</div>
                  <div className={s.isEnabled ? "text-xs text-emerald-300" : "text-xs text-white/40"}>
                    {s.isEnabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
                <div className="mt-1 text-xs text-white/50">{s.id}</div>
              </div>
            ))}
            {!strategies.length && !loading && <div className="text-white/50 text-sm">No strategies yet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="mb-2 text-sm font-medium">Mappings (sample)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/60">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-2 text-left">Scope</th>
                  <th className="px-2 py-2 text-left">Value</th>
                  <th className="px-2 py-2 text-left">Marketplace</th>
                  <th className="px-2 py-2 text-left">Strategy</th>
                  <th className="px-2 py-2 text-left">Paused</th>
                </tr>
              </thead>
              <tbody>
                {topMappings.map((m) => (
                  <tr key={m.id} className="border-b border-white/5">
                    <td className="px-2 py-2">{m.scopeType}</td>
                    <td className="px-2 py-2">{m.scopeValue}</td>
                    <td className="px-2 py-2">{m.marketplaceId}</td>
                    <td className="px-2 py-2">{stratById.get(m.strategyId)?.name ?? m.strategyId}</td>
                    <td className="px-2 py-2">{m.isPaused ? "Yes" : ""}</td>
                  </tr>
                ))}
                {!topMappings.length && !loading && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-white/50">
                      No mappings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-2 text-xs text-white/40">
            Next: weâ€™ll add â€œPricePilotâ€ state + decision logs here (climb/hold/backoff, last good price, baseline velocity,
            last 2d velocity, etc.).
          </div>
        </div>
      </div>
    </div>
  );
}