//app/repricer/mapper/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ScopeType = "SKU" | "SUPPLIER";
// we keep PG selection as extra fields (so Scope is only SKU/SUPPLIER in the UI)


type Assignment = {
  id: string;

  // Scope selector
  scopeType: ScopeType;
  scopeValue: string; // sku OR supplier OR prodGroup value

  // Where it applies
  marketplaceId: string | "ALL";

  // Strategy link
  strategyId: string;

  // Optional per-scope overrides (profit etc) Ã¢â‚¬â€œ leave null to inherit from strategy
  overrideMinProfitGbp?: number | null;
  overrideMaxPriceGbp?: number | null;

  // Automation triggers (your request)
    moveIfNoSalesDays?: number | null;     // trigger
  moveToStrategyIdNoSales?: string | null; // action (no sales)

  moveIfLowStockBelow?: number | null;     // trigger
  moveToStrategyIdLowStock?: string | null; // action (low stock)

  // legacy (back-compat if old saved JSON exists)
  moveToStrategyId?: string | null;
    // NEW: cascading product-group selection under a Supplier scope
  pg1?: string | null;
  pg2?: string | null;
  pg3?: string | null;
  pg4?: string | null;
  pg5?: string | null;
  
  // legacy (back-compat if old saved JSON exists)
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

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((x) => String(x ?? "").trim()).filter(Boolean)));
}

function optionsForLevel(
  pgPaths: any[],
  supplierName: string,
  level: 1 | 2 | 3 | 4 | 5,
  selected: { p1?: string | null; p2?: string | null; p3?: string | null; p4?: string | null }
) {
  const rows = pgPaths.filter((r) => String(r?.supplierName ?? "").trim() === supplierName);

  const out: string[] = [];
  for (const r of rows) {
    const g1 = String(r?.prodGroup1 ?? "").trim();
    const g2 = String(r?.prodGroup2 ?? "").trim();
    const g3 = String(r?.prodGroup3 ?? "").trim();
    const g4 = String(r?.prodGroup4 ?? "").trim();
    const g5 = String(r?.prodGroup5 ?? "").trim();

    if (level >= 2 && selected.p1 && g1 !== selected.p1) continue;
    if (level >= 3 && selected.p2 && g2 !== selected.p2) continue;
    if (level >= 4 && selected.p3 && g3 !== selected.p3) continue;
    if (level >= 5 && selected.p4 && g4 !== selected.p4) continue;

    if (level === 1 && g1) out.push(g1);
    if (level === 2 && g2) out.push(g2);
    if (level === 3 && g3) out.push(g3);
    if (level === 4 && g4) out.push(g4);
    if (level === 5 && g5) out.push(g5);
  }

  return uniq(out).sort();
}

function PgCascade({
  a,
  lookups,
  onUpdate,
}: {
  a: Assignment;
  lookups: any;
  onUpdate: (patch: Partial<Assignment>) => void;
}) {
  const pgPaths = Array.isArray(lookups?.pgPaths) ? lookups.pgPaths : [];

  const supplierName = String(a.scopeValue ?? "").trim();
  if (!supplierName) return null;

  const pg1Opts = optionsForLevel(pgPaths, supplierName, 1, {});
  const pg2Opts = a.pg1 ? optionsForLevel(pgPaths, supplierName, 2, { p1: a.pg1 }) : [];
  const pg3Opts = a.pg2 ? optionsForLevel(pgPaths, supplierName, 3, { p1: a.pg1, p2: a.pg2 }) : [];
  const pg4Opts = a.pg3 ? optionsForLevel(pgPaths, supplierName, 4, { p1: a.pg1, p2: a.pg2, p3: a.pg3 }) : [];
  const pg5Opts = a.pg4 ? optionsForLevel(pgPaths, supplierName, 5, { p1: a.pg1, p2: a.pg2, p3: a.pg3, p4: a.pg4 }) : [];

  const deepest = a.pg5 ? 5 : a.pg4 ? 4 : a.pg3 ? 3 : a.pg2 ? 2 : a.pg1 ? 1 : 0;

  function clearFrom(level: 1 | 2 | 3 | 4 | 5) {
    const patch: Partial<Assignment> = {};
    if (level <= 1) patch.pg1 = null;
    if (level <= 2) patch.pg2 = null;
    if (level <= 3) patch.pg3 = null;
    if (level <= 4) patch.pg4 = null;
    if (level <= 5) patch.pg5 = null;
    onUpdate(patch);
  }

  return (
    <div className="space-y-1">
      {/* PG1 */}
      <div className="flex items-center gap-2">
        <select
          value={a.pg1 ?? ""}
          onChange={(e) => onUpdate({ pg1: e.target.value || null, pg2: null, pg3: null, pg4: null, pg5: null })}
          className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
        >
          <option value="">(PG1 optional)</option>
          {pg1Opts.map((v: string) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {deepest === 1 ? (
          <button type="button" onClick={() => clearFrom(1)} className="text-white/50 hover:text-white text-sm">
            Ãƒâ€”
          </button>
        ) : null}
      </div>

      {/* PG2 */}
      {a.pg1 ? (
        <div className="flex items-center gap-2">
          <select
            value={a.pg2 ?? ""}
            onChange={(e) => onUpdate({ pg2: e.target.value || null, pg3: null, pg4: null, pg5: null })}
            className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
          >
            <option value="">(PG2 optional)</option>
            {pg2Opts.map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {deepest === 2 ? (
            <button type="button" onClick={() => clearFrom(2)} className="text-white/50 hover:text-white text-sm">
              Ãƒâ€”
            </button>
          ) : null}
        </div>
      ) : null}

      {/* PG3 */}
      {a.pg2 ? (
        <div className="flex items-center gap-2">
          <select
            value={a.pg3 ?? ""}
            onChange={(e) => onUpdate({ pg3: e.target.value || null, pg4: null, pg5: null })}
            className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
          >
            <option value="">(PG3 optional)</option>
            {pg3Opts.map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {deepest === 3 ? (
            <button type="button" onClick={() => clearFrom(3)} className="text-white/50 hover:text-white text-sm">
              Ãƒâ€”
            </button>
          ) : null}
        </div>
      ) : null}

      {/* PG4 */}
      {a.pg3 ? (
        <div className="flex items-center gap-2">
          <select
            value={a.pg4 ?? ""}
            onChange={(e) => onUpdate({ pg4: e.target.value || null, pg5: null })}
            className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
          >
            <option value="">(PG4 optional)</option>
            {pg4Opts.map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {deepest === 4 ? (
            <button type="button" onClick={() => clearFrom(4)} className="text-white/50 hover:text-white text-sm">
              Ãƒâ€”
            </button>
          ) : null}
        </div>
      ) : null}

      {/* PG5 */}
      {a.pg4 ? (
        <div className="flex items-center gap-2">
          <select
            value={a.pg5 ?? ""}
            onChange={(e) => onUpdate({ pg5: e.target.value || null })}
            className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
          >
            <option value="">(PG5 optional)</option>
            {pg5Opts.map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {deepest === 5 ? (
            <button type="button" onClick={() => clearFrom(5)} className="text-white/50 hover:text-white text-sm">
              Ãƒâ€”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [strategies, setStrategies] = useState<StrategyLite[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [lookups, setLookups] = useState<{
  marketplaces: { code: string; id: string | "ALL" }[];
  suppliers: string[];
  pgPaths: {
    supplierName: string;
    prodGroup1: string;
    prodGroup2: string;
    prodGroup3: string;
    prodGroup4: string;
    prodGroup5: string;
  }[];
}>({
  marketplaces: [{ code: "ALL", id: "ALL" }],
  suppliers: [],
  pgPaths: [],
});
  // filters
  const [q, setQ] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeType | "ALL">("ALL");
  const [marketFilter, setMarketFilter] = useState<string>("ALL");
  const [cadenceText, setCadenceText] = useState<string>("");

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
        const l = await apiGet<{
  ok: true;
  marketplaces: { code: string; id: string | "ALL" }[];
  suppliers: string[];
  pgPaths: {
    supplierName: string;
    prodGroup1: string;
    prodGroup2: string;
    prodGroup3: string;
    prodGroup4: string;
    prodGroup5: string;
  }[];
}>("/api/repricer/lookups");

setLookups({
  marketplaces: Array.isArray(l.marketplaces) && l.marketplaces.length ? l.marketplaces : [{ code: "ALL", id: "ALL" }],
  suppliers: Array.isArray(l.suppliers) ? l.suppliers : [],
  pgPaths: Array.isArray(l.pgPaths) ? l.pgPaths : [],
});
      } catch {
        // ok (mapper still works without lookups)
      }
    })();

    (async () => {
  try {
    // If you already have this endpoint, use it.
    // Otherwise weÃ¢â‚¬â„¢ll add it (I can give you that file next).
    const s = await apiGet<any>("/api/settings/app");

    // Try a few likely key names (so this doesnÃ¢â‚¬â„¢t redline if naming differs)
    const ukMin =
      s?.settings?.repricerUkCadenceMinutes ??
      s?.repricerUkCadenceMinutes ??
      s?.settings?.ukCadenceMinutes ??
      s?.ukCadenceMinutes ??
      null;

    const euMin =
      s?.settings?.repricerEuCadenceMinutes ??
      s?.repricerEuCadenceMinutes ??
      s?.settings?.euCadenceMinutes ??
      s?.euCadenceMinutes ??
      null;

    const ukStart =
      s?.settings?.repricerUkDayStartHour ??
      s?.repricerUkDayStartHour ??
      s?.settings?.ukDayStartHour ??
      s?.ukDayStartHour ??
      null;

    const ukEnd =
      s?.settings?.repricerUkDayEndHour ??
      s?.repricerUkDayEndHour ??
      s?.settings?.ukDayEndHour ??
      s?.ukDayEndHour ??
      null;

    const euStart =
      s?.settings?.repricerEuDayStartHour ??
      s?.repricerEuDayStartHour ??
      s?.settings?.euDayStartHour ??
      s?.euDayStartHour ??
      null;

    const euEnd =
      s?.settings?.repricerEuDayEndHour ??
      s?.repricerEuDayEndHour ??
      s?.settings?.euDayEndHour ??
      s?.euDayEndHour ??
      null;

    const ukPart =
      ukMin != null
        ? `UK: every ${ukMin}m` + (ukStart != null && ukEnd != null ? ` (${ukStart}:00Ã¢â‚¬â€œ${ukEnd}:00)` : "")
        : "UK: cadence not set";

    const euPart =
      euMin != null
        ? `EU: every ${euMin}m` + (euStart != null && euEnd != null ? ` (${euStart}:00Ã¢â‚¬â€œ${euEnd}:00)` : "")
        : "EU: cadence not set";

    setCadenceText(`${ukPart} Ã¢â‚¬Â¢ ${euPart}`);
  } catch {
    // DonÃ¢â‚¬â„¢t block the page if settings read fails
    setCadenceText("");
  }
})();

    (async () => {
      try {
        const a = await apiGet<{ ok: true; assignments: Assignment[] }>("/api/repricer/assignments");
                const raw = (a.assignments ?? []) as Assignment[];
        const normalized = raw.map((x) => {
          const legacy = (x as any)?.moveToStrategyId ?? null;
          return {
            ...x,
            moveToStrategyIdNoSales: x.moveToStrategyIdNoSales ?? legacy,
            moveToStrategyIdLowStock: x.moveToStrategyIdLowStock ?? legacy,
          };
        });
        setAssignments(normalized);
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
  return Array.isArray(lookups.marketplaces) && lookups.marketplaces.length
    ? lookups.marketplaces
    : [{ code: "ALL", id: "ALL" }];
}, [lookups.marketplaces]);

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
      moveToStrategyIdNoSales: null,

      moveIfLowStockBelow: null,
      moveToStrategyIdLowStock: null,

      moveToStrategyId: null, // legacy
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
          {cadenceText ? (
  <div className="mt-2 inline-flex rounded-xl border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70">
    {cadenceText}
  </div>
) : null}
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
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-xs text-white/60">Marketplace</div>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="w-56 rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
            >
              {(lookups.marketplaces?.length ? lookups.marketplaces : [{ code: "ALL", id: "ALL" }]).map((m) => (
  <option key={m.id} value={m.id}>
    {m.code}
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
  onChange={(e) => {
    const next = e.target.value as ScopeType;
    if (next === "SKU") {
      update(a.id, {
        scopeType: next,
        // keep whatever is typed/pasted
        scopeValue: a.scopeValue,
        pg1: null, pg2: null, pg3: null, pg4: null, pg5: null,
      });
    } else {
      update(a.id, {
        scopeType: next,
        // supplier starts blank until chosen
        scopeValue: "",
        pg1: null, pg2: null, pg3: null, pg4: null, pg5: null,
      });
    }
  }}
  className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
>
  <option value="SKU">SKU</option>
  <option value="SUPPLIER">Supplier</option>
</select>
                  </td>

                  <td className="px-3 py-2">
  {a.scopeType === "SKU" ? (
    <div className="space-y-1">
      <textarea
        value={a.scopeValue}
        onChange={(e) => update(a.id, { scopeValue: e.target.value })}
        className="w-64 min-h-[38px] rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
        placeholder="Paste SKUs (comma or newline separated)"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            const parts = a.scopeValue
              .split(/[\n,]+/g)
              .map((s) => s.trim())
              .filter(Boolean);

            if (parts.length <= 1) return;

            const now = new Date().toISOString();
            const [first, ...rest] = parts;

            // set first into current row
            update(a.id, { scopeValue: first });

            // add additional rows for remaining SKUs
            setAssignments((prev) => {
              const idx = prev.findIndex((x) => x.id === a.id);
              if (idx < 0) return prev;

              const clones: Assignment[] = rest.map((sku) => ({
                ...prev[idx],
                id: uid("asg"),
                scopeType: "SKU",
                scopeValue: sku,
                updatedAtIso: now,
              }));

              const next = [...prev];
              next.splice(idx + 1, 0, ...clones);
              return next;
            });
          }}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
        >
          Apply
        </button>
        <div className="text-[11px] text-white/40 self-center">Creates 1 row per SKU</div>
      </div>
    </div>
    ) : (
    <div className="space-y-2">
  {/* Supplier dropdown */}
  <select
    value={a.scopeValue}
    onChange={(e) =>
      update(a.id, {
        scopeValue: e.target.value,
        pg1: null,
        pg2: null,
        pg3: null,
        pg4: null,
        pg5: null,
      })
    }
    className="w-64 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
  >
    <option value="">(select supplier)</option>
    {(lookups.suppliers ?? []).map((s: string) => (
      <option key={s} value={s}>
        {s}
      </option>
    ))}
  </select>

  {/* PG cascade appears UNDER the supplier dropdown */}
  {a.scopeValue ? (
    <PgCascade
      a={a}
      lookups={lookups}
      onUpdate={(patch) => update(a.id, patch)}
    />
  ) : null}
</div>
  )}
</td>

                  <td className="px-3 py-2">
  <select
    value={String(a.marketplaceId)}
    onChange={(e) => update(a.id, { marketplaceId: e.target.value as any })}
    className="w-56 rounded-lg border border-white/10 bg-black/20 px-2 py-1 outline-none"
  >
    {(lookups.marketplaces?.length ? lookups.marketplaces : [{ code: "ALL", id: "ALL" }]).map((m) => (
      <option key={m.id} value={m.id}>
        {m.code}
      </option>
    ))}
  </select>
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
  <span className="w-28 text-white/50">Move (no sales)</span>
  <select
    value={a.moveToStrategyIdNoSales ?? ""}
    onChange={(e) => update(a.id, { moveToStrategyIdNoSales: e.target.value || null })}
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
  <span className="w-28 text-white/50">Move (low stock)</span>
  <select
    value={a.moveToStrategyIdLowStock ?? ""}
    onChange={(e) => update(a.id, { moveToStrategyIdLowStock: e.target.value || null })}
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
  <div className="flex flex-col items-end gap-2">
    <button
      onClick={() => remove(a.id)}
      className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
    >
      Remove
    </button>

    <button
      type="button"
      onClick={() => {
        const url = `/api/repricer/assignments/export?strategyId=${encodeURIComponent(a.strategyId)}`;
        window.open(url, "_blank");
      }}
      className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
      title="Download mappings for this strategy"
    >
      Download CSV
    </button>
  </div>
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
