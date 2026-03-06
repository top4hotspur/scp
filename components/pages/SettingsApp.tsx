//components/pages/SettingsApps.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, RefreshCw, Clock, ShieldCheck } from "lucide-react";

type AppSettings = {
  id: string;

  ukMarketplaceId: string;
  euInventoryMarketplaceId: string;
  euMarketplaceIdsJson: string;

  inventorySyncEnabled: boolean;
  inventorySyncActiveOnly: boolean;

  inventorySyncCadenceMinutesUk: number;
  inventorySyncCadenceMinutesEuAnchor: number;
  inventoryCoverageScanCadenceMinutesEu: number;

  inventoryLastRunByKeyJson?: string | null;

  updatedAtIso: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const NAME_BY_MID: Record<string, string> = {
  A1F83G8C2ARO7P: "United Kingdom",
  A1PA6795UKMFR9: "Germany",
  A13V1IB3VIYZZH: "France",
  APJ6JRA9NG5V4: "Italy",
  A1RKKUPIHCS9HS: "Spain",
  A1805IZSGTT6HS: "Netherlands",
  AMEN7PMS3EDWL: "Belgium",
  A2NODRKZP88ZB9: "Sweden",
  A1C3SOZRARQ6R3: "Poland",
  A28R8C7NBKEWEA: "Ireland",
};

const ALL_EU_MIDS = [
  "A1PA6795UKMFR9", // Germany
  "A13V1IB3VIYZZH", // France
  "APJ6JRA9NG5V4",  // Italy
  "A1RKKUPIHCS9HS", // Spain
  "A1805IZSGTT6HS", // Netherlands
  "AMEN7PMS3EDWL",  // Belgium
  "A2NODRKZP88ZB9", // Sweden
  "A1C3SOZRARQ6R3", // Poland
  "A28R8C7NBKEWEA", // Ireland
];

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function parseEuList(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map(String).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function stringifyEuList(list: string[]) {
  return JSON.stringify(Array.from(new Set(list)).filter(Boolean));
}

export default function SettingsApp() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [s, setS] = useState<AppSettings | null>(null);

  const euList = useMemo(() => parseEuList(s?.euMarketplaceIdsJson ?? "[]"), [s?.euMarketplaceIdsJson]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/settings/app", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setS(j.settings as AppSettings);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setS(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!s) return;
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      // clamp/sanitize to keep scheduler cheap + safe
      const payload = {
        ...s,
        inventorySyncCadenceMinutesUk: safeInt(s.inventorySyncCadenceMinutesUk, 60),
        inventorySyncCadenceMinutesEuAnchor: safeInt(s.inventorySyncCadenceMinutesEuAnchor, 180),
        inventoryCoverageScanCadenceMinutesEu: safeInt(s.inventoryCoverageScanCadenceMinutesEu, 10080),
        euMarketplaceIdsJson: stringifyEuList(parseEuList(s.euMarketplaceIdsJson)),
      };

      const r = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setS(j.settings as AppSettings);
      setOkMsg("Saved.");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [s]);

  const setHolidayWeekly = useCallback(() => {
    if (!s) return;
    setS({
      ...s,
      inventorySyncEnabled: true,
      inventorySyncActiveOnly: false, // while away, run regardless but very rarely
      inventorySyncCadenceMinutesUk: 10080,
      inventorySyncCadenceMinutesEuAnchor: 10080,
      inventoryCoverageScanCadenceMinutesEu: 10080,
    });
    setOkMsg("Preset applied: Holiday (weekly). Click Save.");
  }, [s]);

  const setNormalActive = useCallback(() => {
    if (!s) return;
    setS({
      ...s,
      inventorySyncEnabled: true,
      inventorySyncActiveOnly: true,
      inventorySyncCadenceMinutesUk: 60,
      inventorySyncCadenceMinutesEuAnchor: 180,
      inventoryCoverageScanCadenceMinutesEu: 10080,
    });
    setOkMsg("Preset applied: Normal (active-only). Click Save.");
  }, [s]);

  const toggleEuMid = useCallback(
    (mid: string) => {
      if (!s) return;
      const list = new Set(parseEuList(s.euMarketplaceIdsJson));
      if (list.has(mid)) list.delete(mid);
      else list.add(mid);
      setS({ ...s, euMarketplaceIdsJson: stringifyEuList(Array.from(list)) });
    },
    [s]
  );

  if (!s) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-lg font-semibold">Settings â€¢ App</div>
          <div className="text-sm opacity-70 mt-1">Inventory cadence & marketplace config.</div>

          {err && <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">{err}</div>}

          <button
            onClick={load}
            className="mt-4 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm inline-flex items-center gap-2"
            disabled={loading}
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Load
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 shadow-sm">
        <div className="px-4 py-3 flex items-start justify-between gap-3 border-b border-white/10">
          <div>
            <div className="text-lg font-semibold">Settings â€¢ App</div>
            <div className="text-xs opacity-70 mt-1">
              Keep costs low: cadence controls + active-only gating. EU totals use a single anchor (default Germany).
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm inline-flex items-center gap-2"
              disabled={loading || saving}
              title="Reload from backend"
            >
              <RefreshCw className={cx("w-4 h-4", (loading || saving) && "animate-spin")} />
              Reload
            </button>
<button
  onClick={async () => {
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/inventory/scheduler/tick", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      const ran = Array.isArray(j.ran) ? j.ran : [];
      const msg =
        ran.length > 0
          ? `Scheduler ran: ${ran.map((x: any) => x.key).join(", ")}`
          : `Scheduler: ${j.reason ?? "ok"}`;

      setOkMsg(msg);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }}
  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm inline-flex items-center gap-2"
  disabled={saving || loading}
  title="Run the scheduler tick now (respects active-only + cadence)"
>
  <RefreshCw className="w-4 h-4" />
  Run scheduler now
</button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/15 text-sm inline-flex items-center gap-2"
              disabled={saving || loading}
              title="Save settings"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">{err}</div>}
          {okMsg && <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-sm">{okMsg}</div>}

          {/* Presets */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="w-4 h-4" />
              Presets
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={setNormalActive}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
              >
                Normal (active-only)
              </button>
              <button
                onClick={setHolidayWeekly}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
              >
                Holiday (weekly)
              </button>
            </div>
            <div className="mt-2 text-xs opacity-70">
              Presets only update the form. Click <span className="opacity-90">Save</span> to apply.
            </div>
          </div>

          {/* Inventory toggles */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4" />
              Inventory Sync
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm flex items-center justify-between gap-3">
                <span>Enabled</span>
                <input
                  type="checkbox"
                  checked={!!s.inventorySyncEnabled}
                  onChange={(e) => setS({ ...s, inventorySyncEnabled: e.target.checked })}
                />
              </label>

              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm flex items-center justify-between gap-3">
                <span>Active only</span>
                <input
                  type="checkbox"
                  checked={!!s.inventorySyncActiveOnly}
                  onChange={(e) => setS({ ...s, inventorySyncActiveOnly: e.target.checked })}
                />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs opacity-70">
                Active-only uses your Viewer heartbeat. Cron remains a backstop.
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="text-xs opacity-70">UK cadence (minutes)</div>
                <input
                  value={String(s.inventorySyncCadenceMinutesUk)}
                  onChange={(e) => setS({ ...s, inventorySyncCadenceMinutesUk: safeInt(e.target.value, 60) })}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
                  inputMode="numeric"
                />
              </label>

              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="text-xs opacity-70">EU anchor cadence (minutes)</div>
                <input
                  value={String(s.inventorySyncCadenceMinutesEuAnchor)}
                  onChange={(e) => setS({ ...s, inventorySyncCadenceMinutesEuAnchor: safeInt(e.target.value, 180) })}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
                  inputMode="numeric"
                />
              </label>

              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="text-xs opacity-70">EU coverage scan (minutes)</div>
                <input
                  value={String(s.inventoryCoverageScanCadenceMinutesEu)}
                  onChange={(e) =>
                    setS({ ...s, inventoryCoverageScanCadenceMinutesEu: safeInt(e.target.value, 10080) })
                  }
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
                  inputMode="numeric"
                />
              </label>
            </div>

            <div className="mt-2 text-xs opacity-70">
              EU totals are anchored to a single marketplace. Coverage scan discovers SKUs not listed in the anchor marketplace.
            </div>
          </div>

          {/* Marketplaces */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-medium">Marketplaces</div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="text-xs opacity-70">UK marketplace</div>
                <select
                  value={s.ukMarketplaceId}
                  onChange={(e) => setS({ ...s, ukMarketplaceId: e.target.value })}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
                >
                  <option value="A1F83G8C2ARO7P">United Kingdom</option>
                </select>
              </label>

              <label className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                <div className="text-xs opacity-70">EU inventory anchor</div>
                <select
                  value={s.euInventoryMarketplaceId}
                  onChange={(e) => setS({ ...s, euInventoryMarketplaceId: e.target.value })}
                  className="mt-2 w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
                >
                  {ALL_EU_MIDS.map((mid) => (
                    <option key={mid} value={mid}>
                      {NAME_BY_MID[mid] ?? "EU Marketplace"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs opacity-70">EU marketplaces (used for dropdown + coverage scan)</div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                {ALL_EU_MIDS.map((mid) => {
                  const checked = euList.includes(mid);
                  return (
                    <label
                      key={mid}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    >
                      <span>{NAME_BY_MID[mid] ?? "EU Marketplace"}</span>
                      <input type="checkbox" checked={checked} onChange={() => toggleEuMid(mid)} />
                    </label>
                  );
                })}
              </div>

              <div className="mt-2 text-xs opacity-70">
                Stored as JSON in <span className="opacity-90">euMarketplaceIdsJson</span>.
              </div>
            </div>
          </div>

          {/* Debug */}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs opacity-80">Debug (read-only)</div>
            <div className="mt-2 text-[11px] leading-4 opacity-80 whitespace-pre-wrap">
              id={s.id} Â· updatedAt={s.updatedAtIso}
              {"\n"}euMarketplaceIdsJson={s.euMarketplaceIdsJson}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}