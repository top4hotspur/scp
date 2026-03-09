"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, RefreshCw } from "lucide-react";

type SettingsResp = { ok: boolean; settings?: any; error?: string };

type AutomationHealthRow = {
  system: string;
  lastAutomationAt: string | null;
  lastSnapshotAt: string | null;
  lastSuccessAt: string | null;
  awsCostPerRunGbp: string;
  note: string;
};

// Backward-compatible alias: older branches referenced CountryCode in VAT helpers.
type CountryCode = string;

type CadenceKey =
  | "15m"
  | "30m"
  | "1hr"
  | "2hr"
  | "3hr"
  | "6hr"
  | "12hr"
  | "Daily"
  | "Weekly"
  | "Monthly";

const CADENCE_OPTIONS: { key: CadenceKey; label: string; minutes: number }[] = [
  { key: "15m", label: "15m", minutes: 15 },
  { key: "30m", label: "30m", minutes: 30 },
  { key: "1hr", label: "1hr", minutes: 60 },
  { key: "2hr", label: "2hr", minutes: 120 },
  { key: "3hr", label: "3hr", minutes: 180 },
  { key: "6hr", label: "6hr", minutes: 360 },
  { key: "12hr", label: "12hr", minutes: 720 },
  { key: "Daily", label: "Daily", minutes: 1440 },
  { key: "Weekly", label: "Weekly", minutes: 10080 },
  { key: "Monthly", label: "Monthly", minutes: 43200 },
];

type ReportKey = "sales.orders" | "sales.snapshot" | "sales.cancellations" | "fee.estimate";

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  {
    key: "sales.orders",
    title: "Sales — Orders report",
    desc: "Near-real-time sales feed (includes unshipped). Used for Overview ‘Today so far’.",
  },
  {
    key: "sales.snapshot",
    title: "Sales — Build snapshot",
    desc: "Rebuild SalesSnapshot buckets from stored SalesLine rows (keeps MI Sales page live).",
  },
  {
    key: "sales.cancellations",
    title: "Sales — Cancellations report",
    desc: "Daily cleanup for cancelled/unshipped orders to keep Overview accurate.",
  },
  {
    key: "fee.estimate",
    title: "Fees — Estimate",
    desc: "Persist fee estimates to SalesLine and include them in profit calculations.",
  },
];

type UiCadence = Record<string, { day: CadenceKey; night: CadenceKey }>;

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function clampHour(n: any, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(23, Math.trunc(x)));
}

function cadenceToMinutes(c: CadenceKey): number {
  return CADENCE_OPTIONS.find((x) => x.key === c)?.minutes ?? 1440;
}

function minutesToCadence(minutes: unknown): CadenceKey {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return "Daily";
  const exact = CADENCE_OPTIONS.find((x) => x.minutes === m);
  if (exact) return exact.key;
  if (m <= 15) return "15m";
  if (m <= 30) return "30m";
  if (m <= 60) return "1hr";
  if (m <= 120) return "2hr";
  if (m <= 180) return "3hr";
  if (m <= 360) return "6hr";
  if (m <= 720) return "12hr";
  return "Daily";
}

function fmtIso(iso: unknown): string {
  const s = String(iso ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [dayStartHour, setDayStartHour] = useState(7);
  const [dayEndHour, setDayEndHour] = useState(22);

  // report cadence
  const [cadences, setCadences] = useState<UiCadence>({
    "sales.orders": { day: "15m", night: "1hr" },
    "sales.snapshot": { day: "15m", night: "1hr" },
    "sales.cancellations": { day: "Daily", night: "Daily" },
    "fee.estimate": { day: "Daily", night: "Daily" },
  });

  const [lastRunByKey, setLastRunByKey] = useState<Record<string, string>>({});
  const [lastSuccessByKey, setLastSuccessByKey] = useState<Record<string, string>>({});
  const [automationHealth, setAutomationHealth] = useState<AutomationHealthRow[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/settings/app", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as SettingsResp;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      const s = j.settings ?? {};

      setDayStartHour(clampHour(s.reportDayStartHour, 7));
      setDayEndHour(clampHour(s.reportDayEndHour, 22));

      const rawCadence = safeJson<Record<string, { enabled?: boolean; dayMinutes?: number; nightMinutes?: number }>>(
        s.reportCadenceByReportJson ?? "{}",
        {}
      );

      setCadences((prev) => {
        const next: UiCadence = { ...prev };
        for (const [k, v] of Object.entries(rawCadence)) {
          next[k] = {
            day: minutesToCadence(v?.dayMinutes),
            night: minutesToCadence(v?.nightMinutes),
          };
        }
        return next;
      });

      setLastRunByKey(safeJson<Record<string, string>>(s.inventoryLastRunByKeyJson ?? "{}", {}));
      setLastSuccessByKey(safeJson<Record<string, string>>(s.reportLastSuccessByKeyJson ?? "{}", {}));

      const hRes = await fetch("/api/settings/automation-health", { cache: "no-store" });
      const hJson = await hRes.json().catch(() => ({}));
      if (hRes.ok && hJson?.ok && Array.isArray(hJson.rows)) {
        setAutomationHealth(hJson.rows as AutomationHealthRow[]);
      } else {
        setAutomationHealth([]);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      const cadencePayload: Record<string, { enabled: boolean; dayMinutes: number; nightMinutes: number }> = {};
      for (const [k, v] of Object.entries(cadences)) {
        cadencePayload[k] = {
          enabled: true,
          dayMinutes: cadenceToMinutes(v.day),
          nightMinutes: cadenceToMinutes(v.night),
        };
      }

      const body = {
        reportDayStartHour: dayStartHour,
        reportDayEndHour: dayEndHour,
        reportCadenceByReportJson: JSON.stringify(cadencePayload),
      };

      const r = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      setOkMsg("Saved.");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const hours = useMemo(() => Array.from({ length: 24 }).map((_, i) => i), []);

  function setReportCadence(reportKey: string, which: "day" | "night", value: CadenceKey) {
    setCadences((prev) => ({
      ...prev,
      [reportKey]: {
        day: prev?.[reportKey]?.day ?? "Daily",
        night: prev?.[reportKey]?.night ?? "Daily",
        [which]: value,
      },
    }));
  }

  const statusRows = useMemo(() => {
    const keys = Array.from(new Set([...Object.keys(lastRunByKey), ...Object.keys(lastSuccessByKey)])).sort();
    return keys.map((k) => ({ key: k, lastRun: lastRunByKey[k], lastSuccess: lastSuccessByKey[k] }));
  }, [lastRunByKey, lastSuccessByKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Settings • Reporting</h1>
          <p className="text-white/60">Configure day/night cadence per report. Scheduler tick reads these settings (STK-style).</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Reload
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-50"
          >
            <Save className={saving ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Save
          </button>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div> : null}
      {okMsg ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{okMsg}</div> : null}


      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-semibold">Automation status + snapshot witness + rough AWS cost</div>
        <div className="text-xs text-white/60">Use this to spot which subsystem has stalled and where to investigate first.</div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-left">System</th>
                <th className="py-2 pr-3 text-left">Last automation</th>
                <th className="py-2 pr-3 text-left">Snapshot saved/updated</th>
                <th className="py-2 pr-3 text-left">Last success</th>
                <th className="py-2 pr-3 text-left">Rough AWS cost / run</th>
                <th className="py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {automationHealth.length ? (
                automationHealth.map((r) => (
                  <tr key={r.system} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-medium">{r.system}</td>
                    <td className="py-2 pr-3">{fmtIso(r.lastAutomationAt)}</td>
                    <td className="py-2 pr-3">{fmtIso(r.lastSnapshotAt)}</td>
                    <td className="py-2 pr-3">{fmtIso(r.lastSuccessAt)}</td>
                    <td className="py-2 pr-3">{r.awsCostPerRunGbp}</td>
                    <td className="py-2 text-white/70">{r.note}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-3 text-white/60">No automation health data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-semibold">Data freshness witness</div>
        <div className="text-xs text-white/60">Quick check of last scheduler run and last successful report windows.</div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-left">Key</th>
                <th className="py-2 pr-3 text-left">Last run</th>
                <th className="py-2 text-left">Last success</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.length ? (
                statusRows.map((r) => (
                  <tr key={r.key} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-mono text-xs">{r.key}</td>
                    <td className="py-2 pr-3">{fmtIso(r.lastRun)}</td>
                    <td className="py-2">{fmtIso(r.lastSuccess)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-3 text-white/60">No witness data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-semibold">Daytime window</div>
        <div className="text-xs text-white/60">Used to choose whether day cadence or night cadence applies. Hours are Europe/London.</div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="space-y-1">
            <div className="text-xs text-white/60">Day starts</div>
            <select
              value={dayStartHour}
              onChange={(e) => setDayStartHour(clampHour(e.target.value, 7))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-xs text-white/60">Day ends</div>
            <select
              value={dayEndHour}
              onChange={(e) => setDayEndHour(clampHour(e.target.value, 22))}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="text-sm font-semibold">Report cadence</div>

        <div className="space-y-3">
          {REPORTS.map((r) => {
            const cur = cadences[r.key] ?? { day: "Daily", night: "Daily" };
            return (
              <div key={r.key} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{r.title}</div>
                    <div className="text-xs text-white/60">{r.desc}</div>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <label className="space-y-1">
                      <div className="text-xs text-white/60">Day cadence</div>
                      <select
                        value={cur.day}
                        onChange={(e) => setReportCadence(r.key, "day", e.target.value as CadenceKey)}
                        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                      >
                        {CADENCE_OPTIONS.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs text-white/60">Night cadence</div>
                      <select
                        value={cur.night}
                        onChange={(e) => setReportCadence(r.key, "night", e.target.value as CadenceKey)}
                        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                      >
                        {CADENCE_OPTIONS.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
