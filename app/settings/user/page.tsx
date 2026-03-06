//app/settings/user/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, RefreshCw } from "lucide-react";

type SettingsResp = { ok: boolean; settings?: any; error?: string };

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

const CADENCE_OPTIONS: { key: CadenceKey; label: string }[] = [
  { key: "15m", label: "15m" },
  { key: "30m", label: "30m" },
  { key: "1hr", label: "1hr" },
  { key: "2hr", label: "2hr" },
  { key: "3hr", label: "3hr" },
  { key: "6hr", label: "6hr" },
  { key: "12hr", label: "12hr" },
  { key: "Daily", label: "Daily" },
  { key: "Weekly", label: "Weekly" },
  { key: "Monthly", label: "Monthly" },
];

type ReportKey = "SALES_ORDERS" | "SALES_BUILD_SNAPSHOT" | "SALES_CANCELLATIONS";

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  {
    key: "SALES_ORDERS",
    title: "Sales — Orders report",
    desc: "Near-real-time sales feed (includes unshipped). Used for Overview â€˜Today so farâ€™.",
  },
  {
  key: "SALES_BUILD_SNAPSHOT",
  title: "Sales — Build snapshot",
  desc: "Rebuild SalesSnapshot buckets from stored SalesLine rows (keeps MI Sales page live).",
},
  {
    key: "SALES_CANCELLATIONS",
    title: "Sales — Cancellations report",
    desc: "Daily cleanup for cancelled/unshipped orders to keep Overview accurate.",
  },
];

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

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // day/night window
  const [dayStartHour, setDayStartHour] = useState(7);
  const [dayEndHour, setDayEndHour] = useState(22);

  // report cadence
  const [cadences, setCadences] = useState<Record<string, { day: CadenceKey; night: CadenceKey }>>({
  SALES_ORDERS: { day: "15m", night: "1hr" },
  SALES_BUILD_SNAPSHOT: { day: "15m", night: "1hr" },
  SALES_CANCELLATIONS: { day: "Daily", night: "Daily" },
});

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

      const fromJson = safeJson<Record<string, { day: CadenceKey; night: CadenceKey }>>(
        s.reportCadenceByReportJson ?? "{}",
        {}
      );

      // merge defaults + persisted
      setCadences((prev) => ({ ...prev, ...fromJson }));
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
      const body = {
        reportDayStartHour: dayStartHour,
        reportDayEndHour: dayEndHour,
        reportCadenceByReportJson: JSON.stringify(cadences),
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
      [reportKey]: { day: prev?.[reportKey]?.day ?? "Daily", night: prev?.[reportKey]?.night ?? "Daily", [which]: value },
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Settings • Reporting</h1>
          <p className="text-white/60">
            Configure day/night cadence per report. Scheduler tick reads these settings (STK-style).
          </p>
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
        <div className="text-sm font-semibold">Daytime window</div>
        <div className="text-xs text-white/60">
          Used to choose whether day cadence or night cadence applies. Hours are Europe/London.
        </div>

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

        <div className="text-xs text-white/60">
          Next: we'll add a "Run now" button per report once the downloader endpoints exist.
        </div>
      </div>
    </div>
  );
}