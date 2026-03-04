//components/pages/SettingsUploads.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Upload, FileText, XCircle } from "lucide-react";

type UploadResp = {
  ok: boolean;
  error?: string;
  total?: number;
  insertedOrUpdated?: number;
  failed?: number;
  errors?: { row: number; sku?: string; error: string }[];
};

type SupplierMapRow = {
  id?: string;
  sku?: string;
  asin?: string;
  shortTitle?: string;
  supplierName?: string;
  prodGroup1?: string;
  prodGroup2?: string;
  productCost?: number | null;
  prepCost?: number | null;
  shippingCost?: number | null;
  label?: string;
  excludeUk?: boolean | null;
  excludeEu?: boolean | null;
  updatedAtIso?: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtMoney(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

export default function SettingsUploads() {
  const [tab, setTab] = useState<"upload" | "preview">("upload");

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResp, setUploadResp] = useState<UploadResp | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [items, setItems] = useState<SupplierMapRow[]>([]);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [pgFilter, setPgFilter] = useState("");
  const [excludedFilter, setExcludedFilter] = useState<"" | "uk" | "eu" | "any">("");

  const canUpload = !!file && !isUploading;

  const pushLog = useCallback((line: string) => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.length > 250 ? next.slice(next.length - 250) : next; // cap
    });
  }, []);

  const onPickFile = useCallback((f: File | null) => {
    setUploadResp(null);
    setLog([]);
    setFile(f);
    if (f) pushLog(`Selected file: ${f.name} (${Math.round(f.size / 1024)} KB)`);
  }, [pushLog]);

  const onBrowse = useCallback(() => inputRef.current?.click(), []);

  const onDrop = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
    const f = ev.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  }, [onPickFile]);

  const onDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
  }, []);

  const runUpload = useCallback(async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadResp(null);
    setLog([]);
    pushLog("Uploading…");

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/suppliermap/upload", {
        method: "POST",
        body: fd,
      });

      const json = (await res.json().catch(() => ({}))) as UploadResp;

      if (!res.ok || !json.ok) {
        const msg = json.error || `HTTP ${res.status}`;
        setUploadResp({ ok: false, error: msg });
        pushLog(`Upload failed: ${msg}`);
        return;
      }

      setUploadResp(json);
      pushLog(`Done. total=${json.total} ok=${json.insertedOrUpdated} failed=${json.failed}`);

      if (json.errors?.length) {
        pushLog(`Showing first ${json.errors.length} errors:`);
        for (const e of json.errors) pushLog(`Row ${e.row} ${e.sku ? `(${e.sku}) ` : ""}- ${e.error}`);
      } else {
        pushLog("No row errors returned.");
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setUploadResp({ ok: false, error: msg });
      pushLog(`Upload exception: ${msg}`);
    } finally {
      setIsUploading(false);
    }
  }, [file, pushLog]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = new URLSearchParams();
      if (supplierFilter.trim()) qs.set("supplier", supplierFilter.trim());
      if (pgFilter.trim()) qs.set("pg", pgFilter.trim());
      if (excludedFilter) qs.set("excluded", excludedFilter);

      const res = await fetch(`/api/suppliermap/preview?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { ok: boolean; error?: string; items?: SupplierMapRow[] };

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setPreviewError(String(e?.message ?? e));
      setItems([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [supplierFilter, pgFilter, excludedFilter]);

  // Auto-load preview when switching to preview tab (cheap, limit=50)
  useEffect(() => {
    if (tab === "preview") loadPreview();
  }, [tab, loadPreview]);

  const headerRight = useMemo(() => {
    if (tab === "upload") {
      return (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPickFile(null)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
            disabled={!file || isUploading}
            title="Clear selected file"
          >
            Clear
          </button>

          <button
            onClick={onBrowse}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
            disabled={isUploading}
          >
            Browse…
          </button>

          <button
            onClick={runUpload}
            className={cx(
              "px-3 py-2 rounded-xl border text-sm flex items-center gap-2",
              canUpload ? "border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/15" : "border-white/10 bg-white/5 opacity-60 cursor-not-allowed"
            )}
            disabled={!canUpload}
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>
      );
    }

    // preview tab right controls
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={loadPreview}
          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
          disabled={previewLoading}
        >
          <RefreshCw className={cx("w-4 h-4", previewLoading && "animate-spin")} />
          Refresh
        </button>
      </div>
    );
  }, [tab, file, isUploading, canUpload, onBrowse, onPickFile, runUpload, loadPreview, previewLoading]);

  return (
    <div className="p-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/10">
          <div>
            <div className="text-lg font-semibold">Uploads</div>
            <div className="text-xs opacity-70">SupplierMap is the spine: repricer floors, restock, profit, exclusions.</div>
          </div>
          {headerRight}
        </div>

        <div className="px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => setTab("upload")}
            className={cx(
              "px-3 py-2 rounded-xl text-sm border",
              tab === "upload" ? "border-white/20 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
            )}
          >
            Upload
          </button>
          <button
            onClick={() => setTab("preview")}
            className={cx(
              "px-3 py-2 rounded-xl text-sm border",
              tab === "preview" ? "border-white/20 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
            )}
          >
            Preview (first 50)
          </button>
        </div>

        {tab === "upload" && (
          <div className="p-4 pt-0">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />

            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={cx(
                "rounded-2xl border border-dashed p-6 transition",
                isDragging ? "border-emerald-400/40 bg-emerald-500/5" : "border-white/15 bg-white/5"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <FileText className="w-5 h-5 opacity-80" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">Drag & drop your SupplierMap CSV here</div>
                  <div className="text-xs opacity-70 mt-1">
                    Expected headers include: <span className="opacity-90">sku, asin, short_title, supplier_name, prod_group_1..5, product_cost, prep_cost, shipping_cost, label, exclude_uk, exclude_eu</span>
                  </div>

                  <div className="mt-3 text-sm">
                    {file ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="truncate">
                          <span className="font-medium">{file.name}</span>
                          <span className="opacity-70"> · {Math.round(file.size / 1024)} KB</span>
                        </div>
                        <button
                          onClick={() => onPickFile(null)}
                          className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                          disabled={isUploading}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="opacity-70">No file selected.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {uploadResp && (
              <div className={cx(
                "mt-4 rounded-2xl border p-3 text-sm",
                uploadResp.ok ? "border-emerald-400/20 bg-emerald-500/5" : "border-red-400/20 bg-red-500/5"
              )}>
                <div className="flex items-center gap-2">
                  {!uploadResp.ok && <XCircle className="w-4 h-4" />}
                  <div className="font-medium">
                    {uploadResp.ok ? "Upload complete" : "Upload failed"}
                  </div>
                </div>
                <div className="mt-2 text-xs opacity-80 whitespace-pre-wrap">
                  {uploadResp.ok
                    ? `total=${uploadResp.total} insertedOrUpdated=${uploadResp.insertedOrUpdated} failed=${uploadResp.failed}`
                    : uploadResp.error}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20">
              <div className="px-3 py-2 border-b border-white/10 text-xs opacity-80">Terminal</div>
              <pre className="p-3 text-[11px] leading-4 overflow-auto max-h-[260px] whitespace-pre-wrap">
                {log.length ? log.join("\n") : "Ready."}
              </pre>
            </div>
          </div>
        )}

        {tab === "preview" && (
          <div className="p-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                placeholder="Filter supplier (contains)"
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
              />
              <input
                value={pgFilter}
                onChange={(e) => setPgFilter(e.target.value)}
                placeholder="Filter prodGroup1 (exact)"
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
              />
              <select
                value={excludedFilter}
                onChange={(e) => setExcludedFilter(e.target.value as any)}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
              >
                <option value="">Excluded: (any)</option>
                <option value="uk">Excluded: UK only</option>
                <option value="eu">Excluded: EU only</option>
                <option value="any">Excluded: UK or EU</option>
              </select>

              <button
                onClick={loadPreview}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center justify-center gap-2"
                disabled={previewLoading}
              >
                <RefreshCw className={cx("w-4 h-4", previewLoading && "animate-spin")} />
                Apply / Refresh
              </button>
            </div>

            {previewError && (
              <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">
                {previewError}
              </div>
            )}

            <div className="mt-3 rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 text-xs opacity-80">
                Rows: {items.length} (limit 50)
              </div>

              <div className="overflow-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-white/5">
                    <tr className="text-left">
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">PG1</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Prep</th>
                      <th className="px-3 py-2">Ship</th>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Ex UK</th>
                      <th className="px-3 py-2">Ex EU</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, idx) => (
                      <tr key={(r.id ?? r.sku ?? "row") + idx} className="border-t border-white/5">
                        <td className="px-3 py-2 font-medium">{r.sku ?? "—"}</td>
                        <td className="px-3 py-2">{r.supplierName ?? "—"}</td>
                        <td className="px-3 py-2">{r.prodGroup1 ?? "—"}</td>
                        <td className="px-3 py-2">{fmtMoney(r.productCost)}</td>
                        <td className="px-3 py-2">{fmtMoney(r.prepCost)}</td>
                        <td className="px-3 py-2">{fmtMoney(r.shippingCost)}</td>
                        <td className="px-3 py-2">{r.label ?? "—"}</td>
                        <td className="px-3 py-2">{r.excludeUk ? "Y" : "—"}</td>
                        <td className="px-3 py-2">{r.excludeEu ? "Y" : "—"}</td>
                        <td className="px-3 py-2 text-xs opacity-70">{r.updatedAtIso ?? "—"}</td>
                      </tr>
                    ))}
                    {!items.length && (
                      <tr>
                        <td className="px-3 py-6 opacity-70" colSpan={10}>
                          {previewLoading ? "Loading…" : "No rows returned."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 text-xs opacity-70">
              Tip: upload → then switch to Preview to validate inserts quickly without hammering anything.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}