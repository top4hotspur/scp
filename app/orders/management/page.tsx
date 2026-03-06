// app/orders/management/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, Download, PlusCircle } from "lucide-react";

type DraftPO = {
  id: string;
  status: string;
  supplier: string;
  marketplaceId: string;
  draftSuffix: string;
  createdAtIso: string;
  updatedAtIso: string;
  totalUnits: number;
  totalValue: number;
};

type DraftLine = {
  id: string;
  purchaseOrderId: string;
  sku: string;
  qty: number;
  unitCost: number;
  lineValue: number;
  updatedAtIso: string;
};

type DraftResp = {
  ok: boolean;
  error?: string;
  draft?: DraftPO;
  lines?: DraftLine[];
};

type ActiveDraft = {
  id: string;
  marketplaceId: string;
  supplier: string;
  draftSuffix: string;
  updatedAtIso: string;
  totalUnits: number;
  totalValue: number;
};

type ActiveResp = {
  ok: boolean;
  error?: string;
  items?: ActiveDraft[];
};

type OptionsResp = {
  ok: boolean;
  error?: string;
  marketplaces?: { id: string; code: string }[];
  suppliers?: string[];
};

function money(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "â€”";
  return v.toFixed(2);
}

function normSku(s: any) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const blob = await res.blob();

  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function Page() {
  const [mid, setMid] = useState<string>("A1F83G8C2ARO7P"); // default UK
  const [supplier, setSupplier] = useState<string>("");

  // bucket identifier (Option B)
  const [draftSuffix, setDraftSuffix] = useState<string>("");

  const [marketplaces, setMarketplaces] = useState<{ id: string; code: string }[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const [draft, setDraft] = useState<DraftPO | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [activeDrafts, setActiveDrafts] = useState<ActiveDraft[]>([]);

  // Quick add line
  const [quickSku, setQuickSku] = useState("");
  const [quickQty, setQuickQty] = useState("1");

  async function loadActiveDrafts() {
  try {
    const res = await fetch("/api/purchase-orders/active", { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as ActiveResp;
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setActiveDrafts(json.items ?? []);
  } catch (e: any) {
    console.warn("active drafts load failed", e?.message);
    setActiveDrafts([]);
  }
}

  async function loadOptions() {
    try {
      const res = await fetch("/api/purchase-orders/options", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as OptionsResp;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setMarketplaces(json.marketplaces ?? []);
      setSuppliers(json.suppliers ?? []);
    } catch (e: any) {
      console.warn("options load failed", e?.message);
    }
  }

  async function loadDraft() {
    setLoading(true);
    setError("");
    try {
      if (!mid || !supplier || !draftSuffix) {
        setDraft(null);
        setLines([]);
        setLoading(false);
        return;
      }

      const res = await fetch(
        `/api/purchase-orders/draft?mid=${encodeURIComponent(mid)}&supplier=${encodeURIComponent(
          supplier
        )}&suffix=${encodeURIComponent(draftSuffix)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as DraftResp;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setDraft(json.draft ?? null);
      setLines(json.lines ?? []);
      loadActiveDrafts();
    } catch (e: any) {
      setError(e?.message ?? "Failed to load draft");
      setDraft(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }

  async function upsertQty(sku: string, qty: number) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/purchase-orders/upsert-line`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mid, supplier, draftSuffix, sku, qty }),
      });
      const json = (await res.json().catch(() => ({}))) as DraftResp;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setDraft(json.draft ?? null);
      setLines(json.lines ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function downloadCsvs() {
    if (!draft?.id) {
      setError("No draft PO yet â€” select marketplace + supplier first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await downloadFile(`/api/purchase-orders/csv?poId=${encodeURIComponent(draft.id)}&type=manifest`, "manifest.csv");
      await downloadFile(`/api/purchase-orders/csv?poId=${encodeURIComponent(draft.id)}&type=labels`, "labels.csv");
    } catch (e: any) {
      setError(e?.message ?? "CSV download failed");
    } finally {
      setLoading(false);
    }
  }

  async function deletePo() {
    if (!draft?.id) {
      setError("No draft PO to delete.");
      return;
    }

    const ok = window.confirm(
      "Delete this Purchase Order permanently?\n\nThis cannot be undone.\n\nPlease ensure you have downloaded BOTH Manifest and Labels files before deleting."
    );
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/purchase-orders/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poId: draft.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setDraft(null);
      setLines([]);
      loadActiveDrafts();
      // start a fresh bucket immediately
      setDraftSuffix("active");
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  loadOptions();
  loadActiveDrafts();
}, []);

  // Stable bucket so Restock + Management share the same draft
useEffect(() => {
  if (mid && supplier) {
    setDraftSuffix("active");
  } else {
    setDraftSuffix("");
  }
}, [mid, supplier]);

  // load draft whenever bucket changes
  useEffect(() => {
    loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mid, supplier, draftSuffix]);

  const totals = useMemo(() => {
    const units = lines.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const value = lines.reduce((s, r) => s + (Number(r.lineValue) || 0), 0);
    return { units, value };
  }, [lines]);

  const midLabel = useMemo(() => marketplaces.find((m) => m.id === mid)?.code ?? mid, [marketplaces, mid]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Orders â€¢ Management</h1>
          <p className="text-white/60">Draft Purchase Order (snapshot-first, no SP-API).</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={downloadCsvs}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={loading || !draft?.id}
          >
            <Download className="h-4 w-4" />
            Download CSVs
          </button>

          <button
            onClick={deletePo}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/15 disabled:opacity-50"
            disabled={loading || !draft?.id}
          >
            <Trash2 className="h-4 w-4" />
            Delete PO
          </button>

          <button
            onClick={loadDraft}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs text-white/60">Marketplace</div>

          <select
            value={mid}
            onChange={(e) => setMid(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            {(marketplaces.length ? marketplaces : [{ id: mid, code: mid }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.code}
              </option>
            ))}
          </select>

          <div className="mt-1 text-[11px] text-white/40">ID: {mid}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 md:col-span-2">
          <div className="text-xs text-white/60">Supplier</div>

          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            <option value="">Select supplierâ€¦</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="mt-1 text-[11px] text-white/40">
            Bucket: {draftSuffix || "â€”"}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
  <div className="text-xs text-white/60">Active drafts</div>

  <div className="mt-2 max-h-[140px] overflow-auto space-y-2">
    {activeDrafts.length === 0 ? (
      <div className="text-sm text-white/40">None</div>
    ) : (
      activeDrafts.map((d) => {
        const midLabel = marketplaces.find((m) => m.id === d.marketplaceId)?.code ?? d.marketplaceId;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => {
              setMid(d.marketplaceId);
              setSupplier(d.supplier);
              setDraftSuffix(d.draftSuffix || "active");
            }}
            className="w-full text-left rounded-xl border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/10"
            title="Load this draft"
          >
            <div className="text-sm text-white">
              {midLabel} â€¢ {d.supplier}
            </div>
            <div className="text-[11px] text-white/50">
              bucket: {d.draftSuffix || "â€”"} Â· {d.totalUnits} units
            </div>
          </button>
        );
      })
    )}
  </div>
</div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-white/70">
            Draft: <span className="text-white">{draft?.id ?? "â€”"}</span>{" "}
            <span className="text-white/40">({draft?.status ?? "â€”"})</span>
            <span className="ml-3 text-white/40">
              {supplier ? `${supplier} â€¢ ${midLabel} â€¢ ${draftSuffix}` : ""}
            </span>
          </div>
          <div className="text-sm text-white/70">
            Totals: <span className="text-white">{totals.units}</span> units Â·{" "}
            <span className="text-white">{money(totals.value)}</span>
          </div>
        </div>

        {/* Quick add */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <div className="text-xs text-white/60">Quick add SKU</div>
            <input
              value={quickSku}
              onChange={(e) => setQuickSku(e.target.value)}
              className="w-[240px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              placeholder="e.g. 4771"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-white/60">Qty</div>
            <input
              value={quickQty}
              onChange={(e) => setQuickQty(e.target.value.replace(/[^\d]/g, ""))}
              className="w-[120px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none text-right"
              inputMode="numeric"
            />
          </label>
          <button
            type="button"
            disabled={loading || !supplier || !mid || !draftSuffix}
            onClick={() => {
              const sku = normSku(quickSku);
              const qty = Math.max(0, Math.trunc(Number(quickQty || "0")));
              if (!sku) return;
              upsertQty(sku, qty > 0 ? qty : 1);
              setQuickSku("");
              setQuickQty("1");
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4" />
            Add line
          </button>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="text-white/60">
              <tr className="border-b border-white/10">
                <th className="py-2 text-left">SKU</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td className="py-4 text-white/50" colSpan={5}>
                    No lines yet. Add from Restock (+) or use Quick add.
                  </td>
                </tr>
              ) : (
                lines.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="py-2 font-mono">{r.sku}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={r.qty}
                        onChange={(e) => upsertQty(r.sku, Number(e.target.value))}
                        className="w-20 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-right outline-none"
                        disabled={loading}
                      />
                    </td>
                    <td className="py-2 text-right">{money(r.unitCost)}</td>
                    <td className="py-2 text-right">{money(r.lineValue)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => upsertQty(r.sku, 0)}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10"
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}