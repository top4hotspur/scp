"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Download } from "lucide-react";

type CleanSnap = {
  marketplaceId: string;
  bucket: string;
  createdAtIso: string;
  total: number;
  countsByStatusJson?: string | null;
};

type CleanRow = {
  marketplaceId: string;
  sku: string;
  asin?: string | null;
  title?: string | null;
  issueType?: string | null; // present for Fulfillment issue rows (from CleanListingIssue)
  price?: string | null;
  quantity?: string | null;
  status?: string | null; // bucket label
  fulfillmentChannel?: string | null;
  updatedAtIso?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtIso(iso?: string) {
  if (!iso) return "â€”";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());

  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  // dd/mm/yyyy hh:mm:ss (no Z)
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  try {
    if (raw === null || raw === undefined) return fallback;
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function sellerCentralDomainForMarketplace(mid: string): string {
  // Keep it simple: you can extend later if needed.
  if (mid === "A1F83G8C2ARO7P") return "sellercentral.amazon.co.uk";
  // EU generally uses .de for unified UI, but SKU search still works there.
  return "sellercentral.amazon.de";
}

function sellerCentralInventoryLink(mid: string, sku: string, bucket: string): string {
  const domain = sellerCentralDomainForMarketplace(mid);

  // Map our bucket to SellerCentralâ€™s status param (best-effort).
  const statusMap: Record<string, string> = {
    "Detail Page Removed": "detail_page_removed",
    "Search suppressed": "search_suppressed",
    "Improve listing quality": "improve_listing_quality",
    "Out of Stock": "out_of_stock",
    "Approval Required": "approval_required",
    "Fulfillment issue": "inactive", // Seller Central doesn't have "stranded" status filter in inventory view
    "Inactive": "inactive",
    "Active": "active",
  };

  const statusParam = statusMap[bucket] ?? "all";
  const qs = new URLSearchParams();
  qs.set("fulfilledBy", "all");
  qs.set("page", "1");
  qs.set("pageSize", "25");
  qs.set("searchField", "all");
  qs.set("searchTerm", sku);
  qs.set("sort", "date_created_desc");
  qs.set("status", statusParam);

  return `https://${domain}/myinventory/inventory?${qs.toString()}`;
}

function marketplaceName(mid: string): string {
  const map: Record<string, string> = {
    A1F83G8C2ARO7P: "UK",
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
  return map[mid] ?? mid;
}

export default function Page() {
  const [mid, setMid] = useState<string>("A1F83G8C2ARO7P");
  const [mids, setMids] = useState<Array<{ mid: string; name: string }>>([
    { mid: "A1F83G8C2ARO7P", name: "UK" },
  ]);

  const [snap, setSnap] = useState<CleanSnap | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>(""); // "" = all
  const [rows, setRows] = useState<CleanRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load marketplaces once (from settings)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/app", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as any;
        if (!r.ok || !j?.ok) return;

        const s = j.settings ?? {};
        const uk = String(s.ukMarketplaceId ?? "A1F83G8C2ARO7P").trim();
        const euJson = String(s.euMarketplaceIdsJson ?? "[]");
        const euMids = safeJsonParse<string[]>(euJson, []).map(String).map((x) => x.trim()).filter(Boolean);

        const list = [
          { mid: uk, name: marketplaceName(uk) },
          ...euMids
            .filter((x) => x && x !== uk)
            .map((x) => ({ mid: x, name: marketplaceName(x) })),
        ];

        setMids(list);
        if (!list.find((x) => x.mid === mid)) setMid(list[0]?.mid ?? uk);
      } catch {
        // ignore
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  const loadSnapshot = useCallback(async () => {
  setErr(null);
  try {
    const r = await fetch(`/api/clean/snapshot?mid=${encodeURIComponent(mid)}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

    const s = (j.snapshot ?? null) as CleanSnap | null;
    setSnap(s);

    // Prefer combinedCounts (includes STRANDED overlay)
    if (j?.combinedCounts && typeof j.combinedCounts === "object") {
      setCounts(j.combinedCounts as Record<string, number>);
    } else {
      const c = safeJsonParse<Record<string, number>>(s?.countsByStatusJson ?? "{}", {});
      setCounts(c);
    }

  } catch (e: any) {
    setSnap(null);
    setCounts({});
    throw e;
  }
}, [mid]);

  const loadRows = useCallback(async () => {
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set("mid", mid);
      if (status) qs.set("status", status);

      const r = await fetch(`/api/clean/drilldown?${qs.toString()}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      setRows(Array.isArray(j?.rows) ? (j.rows as CleanRow[]) : []);
    } catch (e: any) {
      setRows([]);
      throw e;
    }
  }, [mid, status]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      await loadSnapshot();
      await loadRows();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [loadSnapshot, loadRows]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const headerSub = useMemo(() => {
    if (!snap) return "Listing Health (snapshot-first). Uses Amazon Reports â†’ stored rows â†’ snapshot + drilldown.";
    return `Snapshot Â· ${marketplaceName(mid)} Â· ${fmtIso(snap.createdAtIso)} Â· total ${snap.total ?? 0}`;
  }, [snap]);

  const statusOptions = useMemo(() => {
    // Always include ""=All, then counts keys by descending size
    const entries = Object.entries(counts ?? {});
    entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const list = [{ key: "", label: "All", n: snap?.total ?? entries.reduce((acc, [, v]) => acc + (v ?? 0), 0) }];
    for (const [k, v] of entries) list.push({ key: k, label: k, n: v ?? 0 });
    return list;
  }, [counts, snap?.total]);

  const runAllListingsIngest = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/clean/all-listings/ingest?mid=${encodeURIComponent(mid)}`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      // after ingest, refresh snapshot + drilldown
      await loadAll();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [mid, loadAll]);

  function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildBulkDeleteCsv(skus: string[]) {
  const bom = "\uFEFF";
  const headers = ["sku", "add-delete"];
  const lines = [headers.join(",")];
  for (const sku of skus) {
    const s = String(sku ?? "").trim();
    if (!s) continue;
    lines.push(`${csvEscape(s)},delete`);
  }
  return bom + lines.join("\n");
}

  const downloadCsv = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      qs.set("mid", mid);
      qs.set("download", "1");
      if (status) qs.set("status", status);

      // Trigger file download (browser)
      window.location.href = `/api/clean/drilldown?${qs.toString()}`;
    } catch {
      // ignore
    }
  }, [mid, status]);

  const downloadBulkDeleteBlank = useCallback(() => {
  const name = `Bulk Delete - ${marketplaceName(mid)} - BLANK.csv`;
  const csv = "\uFEFF" + ["sku,add-delete"].join("\n");
  downloadTextFile(name, csv);
}, [mid]);

const downloadBulkDeletePopulated = useCallback(() => {
  const bucketName = status ? status : "All";
  const name = `Bulk Delete - ${marketplaceName(mid)} - ${bucketName}.csv`;
  const skus = rows.map((r) => r.sku).filter(Boolean);
  const csv = buildBulkDeleteCsv(skus);
  downloadTextFile(name, csv);
}, [mid, status, rows]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">MI â€¢ Clean</h1>
          <p className="text-white/60">{headerSub}</p>
          {!!Object.keys(counts ?? {}).length && (
  <p className="text-white/60 text-sm">
    {Object.entries(counts)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k, v]) => `${k}: ${v ?? 0}`)
      .join(" Â· ")}
  </p>
)}
        </div>

        <div className="flex items-center gap-2">
          {/* Marketplace */}
          <select
            value={mid}
            onChange={(e) => setMid(e.target.value)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-black"
            disabled={loading}
            title="Marketplace"
          >
            {mids.map((x) => (
              <option key={x.mid} value={x.mid}>
                {x.name}
              </option>
            ))}
          </select>

          {/* Status bucket */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
            disabled={loading}
            title="Bucket"
          >
            {statusOptions.map((o) => (
              <option key={o.key || "__all"} value={o.key}>
                {o.label} ({o.n})
              </option>
            ))}
          </select>

          <button
            onClick={runAllListingsIngest}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
            disabled={loading}
            title="Run Amazon Reports ingest (All Listings) for this marketplace"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Run Marketplace Listings
          </button>

          <button
            onClick={loadAll}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
            disabled={loading}
            title="Refresh snapshot + drilldown from stored data (cheap)"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>

          <button
            onClick={downloadCsv}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
            disabled={loading}
            title="Download CSV for current bucket"
          >
            <Download className="w-4 h-4" />
            Download CSV
          </button>
          <button
  onClick={downloadBulkDeleteBlank}
  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
  disabled={loading}
  title="Download blank bulk delete template"
>
  <Download className="w-4 h-4" />
  Bulk Delete (blank)
</button>

<button
  onClick={downloadBulkDeletePopulated}
  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
  disabled={loading || rows.length === 0}
  title="Download bulk delete template populated with the currently filtered table"
>
  <Download className="w-4 h-4" />
  Bulk Delete (filled)
</button>
        </div>
      </div>

      {/* Error */}
      {err && (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">
          {err}
        </div>
      )}


      {/* Counts table */}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-3 py-2 border-b border-white/10 text-xs opacity-80">Buckets</div>
        <div className="overflow-auto">
          <table className="min-w-[560px] w-full text-sm">
            <thead className="bg-white/5 sticky top-0 z-10">
              <tr className="text-left">
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(counts ?? {})
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .map(([k, v]) => (
                  <tr key={k} className="border-t border-white/5">
                    <td className="px-3 py-2 font-medium">{k}</td>
                    <td className="px-3 py-2">{v ?? 0}</td>
                  </tr>
                ))}

              {!Object.keys(counts ?? {}).length && (
                <tr>
                  <td className="px-3 py-6 opacity-70" colSpan={2}>
                    {loading ? "Loadingâ€¦" : "No bucket counts yet. Run All Listings ingest."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drilldown table */}
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-3 py-2 border-b border-white/10 text-xs opacity-80">
          Drilldown Â· {status ? status : "All"} Â· {rows.length}
        </div>

        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-white/5">
  <tr className="text-left">
    <th className="px-3 py-2">SKU</th>
    <th className="px-3 py-2">Title</th>
    <th className="px-3 py-2">Qty</th>
    <th className="px-3 py-2">Bucket</th>
    <th className="px-3 py-2">FC</th>
  </tr>
</thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.sku}-${idx}`} className="border-t border-white/5">
                  <td className="px-3 py-2 font-medium">
  <a
    href={sellerCentralInventoryLink(mid, r.sku, String(r.status ?? (r.issueType ? "Fulfillment issue" : "")))}
    target="_blank"
    rel="noreferrer"
    className="underline decoration-white/20 hover:decoration-white/60"
    title="Open in Seller Central (new tab)"
  >
    {r.sku}
  </a>
</td>
<td className="px-3 py-2">
  {r.title ?? (r.issueType ? `(${r.issueType})` : "")}
</td>
<td className="px-3 py-2">{r.quantity ?? ""}</td>
<td className="px-3 py-2">{r.status ?? (r.issueType ? "Fulfillment issue" : "")}</td>
<td className="px-3 py-2">{r.fulfillmentChannel ?? ""}</td>
                </tr>
              ))}

              {!rows.length && (
                <tr>
                  <td className="px-3 py-6 opacity-70" colSpan={5}>
                    {loading ? "Loadingâ€¦" : "No rows for this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footnote */}
      <div className="text-xs opacity-60">
        This page uses stored CleanListing rows + one CleanListingSnapshot record. No per-SKU SP-API calls. STK-style.
      </div>
    </div>
  );
}