//app/repicer/strategies/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type StepMode = "PCT" | "FIXED" | "MAX_OF_BOTH";

type OnlySellerMode =
  | "GO_MAX"
  | "GO_MIN"
  | "STEP_UP_PCT_DAILY"
  | "STEP_UP_GBP_DAILY"
  | "STEP_UP_MAX_OF_BOTH"
  | "HOLD";

type BuyBoxWhenOwning =
  | "HOLD"
  | "RAISE_SLOWLY"
  | "RAISE_TO_MAX"
  | "STEP_UP_PCT_DAILY"
  | "STEP_UP_GBP_DAILY";

type VelocityGuard = {
  enabled: boolean;
  baselineBucket: "30d" | "7d";
  lookbackDays: 2 | 3 | 5;
  minPctOfBaseline: number; // e.g. 0.6 = 60%
  consecutiveDays: 2 | 3;
  backoffAction: "REVERT_LAST_GOOD" | "STEP_DOWN_ONE" | "GO_MIN" | "PAUSE";
  cooldownDays: 1 | 2 | 3 | 5;
};

export type Strategy = {
  id: string;
  name: string;
  isEnabled: boolean;

  // Core behavior
  priceMatchMode: "MATCH_BUYBOX" | "MATCH_LOWEST_FBA" | "HOLD";
  allowUndercut: boolean; // you prefer false (race-to-bottom off)
  undercutPence?: number; // optional if allowUndercut=true

  // Floors/ceilings (seller chooses which metric)
  minProfitGbp?: number;
  minMarginPct?: number;
  minRoiPct?: number;

  maxProfitGbp?: number;
  maxMarginPct?: number;
  maxRoiPct?: number;

  // Buy Box behavior
  whenOwnBuyBox: BuyBoxWhenOwning;

  // Sole seller behavior
  whenOnlySeller: OnlySellerMode;

  // Step config (shared by step-up-actions)
  stepMode: StepMode;
  stepPctPerDay?: number; // e.g. 1
  stepGbpPerDay?: number; // e.g. 0.05
  maxPriceGbp?: number;   // optional hard max price

  // Filters
  competeAgainstAmazon: boolean;
  competeAgainstFba: boolean;
  competeAgainstFbm: boolean;

  // Safety
  minMinutesBetweenChanges: number; // e.g. 60
  maxChangesPerDay: number;         // e.g. 4
  ignoreTinyMovesPence: number;     // e.g. 2

  // Clever bit: velocity guard
  velocityGuard: VelocityGuard;

  updatedAtIso: string;
};

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

function defaultStrategy(): Strategy {
  const now = new Date().toISOString();
  return {
    id: uid("stg"),
    name: "Default Ã¢â‚¬Â¢ Match + Guard",
    isEnabled: true,

    priceMatchMode: "MATCH_BUYBOX",
    allowUndercut: false,

    minProfitGbp: 1.0,

    whenOwnBuyBox: "RAISE_SLOWLY",
    whenOnlySeller: "STEP_UP_PCT_DAILY",

    stepMode: "PCT",
    stepPctPerDay: 1,
    stepGbpPerDay: 0.05,
    maxPriceGbp: undefined,

    competeAgainstAmazon: true,
    competeAgainstFba: true,
    competeAgainstFbm: false,

    minMinutesBetweenChanges: 60,
    maxChangesPerDay: 4,
    ignoreTinyMovesPence: 2,

    velocityGuard: {
      enabled: true,
      baselineBucket: "30d",
      lookbackDays: 2,
      minPctOfBaseline: 0.6,
      consecutiveDays: 2,
      backoffAction: "REVERT_LAST_GOOD",
      cooldownDays: 3,
    },

    updatedAtIso: now,
  };
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => strategies.find((s) => s.id === selectedId) ?? null,
    [strategies, selectedId]
  );

  useEffect(() => {
    (async () => {
      try {
        const j = await apiGet<{ ok: true; strategies: Strategy[] }>("/api/repricer/strategies");
        const arr = Array.isArray(j.strategies) ? j.strategies : [];
        setStrategies(arr.length ? arr : [defaultStrategy()]);
        setSelectedId(arr.length ? arr[0].id : null);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        // allow offline editing
        const seed = [defaultStrategy()];
        setStrategies(seed);
        setSelectedId(seed[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateSelected(patch: Partial<Strategy>) {
    if (!selected) return;
    setStrategies((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, ...patch, updatedAtIso: new Date().toISOString() } : s))
    );
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      await apiPut("/api/repricer/strategies", { strategies });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function addStrategy() {
    const s = defaultStrategy();
    s.name = `Strategy ${strategies.length + 1}`;
    setStrategies((p) => [s, ...p]);
    setSelectedId(s.id);
  }

  function cloneSelected() {
    if (!selected) return;
    const s: Strategy = { ...selected, id: uid("stg"), name: `${selected.name} (copy)`, updatedAtIso: new Date().toISOString() };
    setStrategies((p) => [s, ...p]);
    setSelectedId(s.id);
  }

  function deleteSelected() {
    if (!selected) return;
    if (strategies.length <= 1) return;
    const next = strategies.filter((s) => s.id !== selected.id);
    setStrategies(next);
    setSelectedId(next[0]?.id ?? null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Repricer Ã¢â‚¬Â¢ Strategies</h1>
          <p className="text-white/60">
            Define how we price: match (no 1p race), Buy Box handling, only-seller climb, velocity guard + backoff.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={addStrategy}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
          >
            + New
          </button>
          <button
            onClick={cloneSelected}
            disabled={!selected}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-40"
          >
            Duplicate
          </button>
          <button
            onClick={deleteSelected}
            disabled={!selected || strategies.length <= 1}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-40"
          >
            Delete
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
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Left: list */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">Strategies</div>
          <div className="space-y-2">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={[
                  "w-full rounded-xl border px-3 py-2 text-left",
                  s.id === selectedId ? "border-white/20 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{s.name}</div>
                  <span className={s.isEnabled ? "text-emerald-300 text-xs" : "text-white/40 text-xs"}>
                    {s.isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-white/60">
                  {s.priceMatchMode.replaceAll("_", " ")} Ã¢â‚¬Â¢ Own BB: {s.whenOwnBuyBox.replaceAll("_", " ")} Ã¢â‚¬Â¢ Only seller:{" "}
                  {s.whenOnlySeller.replaceAll("_", " ")}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: editor */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          {!selected ? (
            <div className="text-white/60">Select a strategy.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <div className="text-xs text-white/60">Name</div>
                  <input
                    value={selected.name}
                    onChange={(e) => updateSelected({ name: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                  />
                </label>

                <label className="flex items-end gap-2">
                  <input
                    type="checkbox"
                    checked={selected.isEnabled}
                    onChange={(e) => updateSelected({ isEnabled: e.target.checked })}
                  />
                  <span className="text-sm text-white/70">Enabled</span>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <div className="text-xs text-white/60">Match mode</div>
                  <select
                    value={selected.priceMatchMode}
                    onChange={(e) => updateSelected({ priceMatchMode: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                  >
                    <option value="MATCH_BUYBOX">Match Buy Box</option>
                    <option value="MATCH_LOWEST_FBA">Match lowest FBA</option>
                    <option value="HOLD">Hold (never reduce)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <div className="text-xs text-white/60">When you own Buy Box</div>
                  <select
                    value={selected.whenOwnBuyBox}
                    onChange={(e) => updateSelected({ whenOwnBuyBox: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                  >
                    <option value="HOLD">Hold</option>
                    <option value="RAISE_SLOWLY">Raise slowly</option>
                    <option value="RAISE_TO_MAX">Raise to max</option>
                    <option value="STEP_UP_PCT_DAILY">Step up % daily</option>
                    <option value="STEP_UP_GBP_DAILY">Step up Ã‚£ daily</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <div className="text-xs text-white/60">When only seller</div>
                  <select
                    value={selected.whenOnlySeller}
                    onChange={(e) => updateSelected({ whenOnlySeller: e.target.value as any })}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                  >
                    <option value="HOLD">Hold</option>
                    <option value="GO_MAX">Go to max</option>
                    <option value="GO_MIN">Go to min</option>
                    <option value="STEP_UP_PCT_DAILY">Step up % daily</option>
                    <option value="STEP_UP_GBP_DAILY">Step up Ã‚£ daily</option>
                    <option value="STEP_UP_MAX_OF_BOTH">Step up (max of Ã‚£/% daily)</option>
                  </select>
                </label>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-sm font-medium">Floors / Ceilings</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Min profit (Ã‚£)</div>
                    <input
                      type="number"
                      value={selected.minProfitGbp ?? ""}
                      onChange={(e) => updateSelected({ minProfitGbp: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Min margin (%)</div>
                    <input
                      type="number"
                      value={selected.minMarginPct ?? ""}
                      onChange={(e) => updateSelected({ minMarginPct: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Min ROI (%)</div>
                    <input
                      type="number"
                      value={selected.minRoiPct ?? ""}
                      onChange={(e) => updateSelected({ minRoiPct: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Max profit (Ã‚£)</div>
                    <input
                      type="number"
                      value={selected.maxProfitGbp ?? ""}
                      onChange={(e) => updateSelected({ maxProfitGbp: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Max margin (%)</div>
                    <input
                      type="number"
                      value={selected.maxMarginPct ?? ""}
                      onChange={(e) => updateSelected({ maxMarginPct: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Max ROI (%)</div>
                    <input
                      type="number"
                      value={selected.maxRoiPct ?? ""}
                      onChange={(e) => updateSelected({ maxRoiPct: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-sm font-medium">Step Up config (used by Buy Box / only-seller climb)</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Step mode</div>
                    <select
                      value={selected.stepMode}
                      onChange={(e) => updateSelected({ stepMode: e.target.value as any })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value="PCT">Percent</option>
                      <option value="FIXED">Fixed Ã‚£</option>
                      <option value="MAX_OF_BOTH">Max(Ã‚£,%)</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Step % / day</div>
                    <input
                      type="number"
                      value={selected.stepPctPerDay ?? ""}
                      onChange={(e) => updateSelected({ stepPctPerDay: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Step Ã‚£ / day</div>
                    <input
                      type="number"
                      value={selected.stepGbpPerDay ?? ""}
                      onChange={(e) => updateSelected({ stepGbpPerDay: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Hard max price (Ã‚£)</div>
                    <input
                      type="number"
                      value={selected.maxPriceGbp ?? ""}
                      onChange={(e) => updateSelected({ maxPriceGbp: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-sm font-medium">Velocity guard (the Ã¢â‚¬Å“cleverÃ¢â‚¬Â bit)</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex items-end gap-2">
                    <input
                      type="checkbox"
                      checked={selected.velocityGuard.enabled}
                      onChange={(e) => updateSelected({ velocityGuard: { ...selected.velocityGuard, enabled: e.target.checked } })}
                    />
                    <span className="text-sm text-white/70">Enabled</span>
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Baseline bucket</div>
                    <select
                      value={selected.velocityGuard.baselineBucket}
                      onChange={(e) =>
                        updateSelected({ velocityGuard: { ...selected.velocityGuard, baselineBucket: e.target.value as any } })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value="30d">30d</option>
                      <option value="7d">7d</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Lookback days</div>
                    <select
                      value={selected.velocityGuard.lookbackDays}
                      onChange={(e) =>
                        updateSelected({ velocityGuard: { ...selected.velocityGuard, lookbackDays: Number(e.target.value) as any } })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={5}>5</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Min % of baseline</div>
                    <input
                      type="number"
                      step="0.05"
                      value={selected.velocityGuard.minPctOfBaseline}
                      onChange={(e) =>
                        updateSelected({
                          velocityGuard: { ...selected.velocityGuard, minPctOfBaseline: Number(e.target.value) },
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Consecutive days</div>
                    <select
                      value={selected.velocityGuard.consecutiveDays}
                      onChange={(e) =>
                        updateSelected({
                          velocityGuard: { ...selected.velocityGuard, consecutiveDays: Number(e.target.value) as any },
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Backoff action</div>
                    <select
                      value={selected.velocityGuard.backoffAction}
                      onChange={(e) =>
                        updateSelected({
                          velocityGuard: { ...selected.velocityGuard, backoffAction: e.target.value as any },
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value="REVERT_LAST_GOOD">Revert to last good</option>
                      <option value="STEP_DOWN_ONE">Step down one</option>
                      <option value="GO_MIN">Go to min</option>
                      <option value="PAUSE">Pause</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Cooldown days</div>
                    <select
                      value={selected.velocityGuard.cooldownDays}
                      onChange={(e) =>
                        updateSelected({
                          velocityGuard: { ...selected.velocityGuard, cooldownDays: Number(e.target.value) as any },
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={5}>5</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-sm font-medium">Compete against</div>
                <div className="flex flex-wrap gap-4 text-sm text-white/70">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.competeAgainstAmazon}
                      onChange={(e) => updateSelected({ competeAgainstAmazon: e.target.checked })}
                    />
                    Amazon
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.competeAgainstFba}
                      onChange={(e) => updateSelected({ competeAgainstFba: e.target.checked })}
                    />
                    FBA sellers
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.competeAgainstFbm}
                      onChange={(e) => updateSelected({ competeAgainstFbm: e.target.checked })}
                    />
                    FBM sellers
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-sm font-medium">Anti-thrash safeguards</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Min minutes between changes</div>
                    <input
                      type="number"
                      value={selected.minMinutesBetweenChanges}
                      onChange={(e) => updateSelected({ minMinutesBetweenChanges: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Max changes per day</div>
                    <input
                      type="number"
                      value={selected.maxChangesPerDay}
                      onChange={(e) => updateSelected({ maxChangesPerDay: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-white/60">Ignore tiny moves (pence)</div>
                    <input
                      type="number"
                      value={selected.ignoreTinyMovesPence}
                      onChange={(e) => updateSelected({ ignoreTinyMovesPence: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="text-xs text-white/40">
                Stored in AppSettings JSON for now (cheap + stable). Worker + Listings truth come next.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
