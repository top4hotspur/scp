//app/new-products/search/Module.tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Search as SearchIcon } from "lucide-react";

type ScanRow = {
  ean: string;
  marketplaceId: string;
  ok: boolean;
  fromCache: boolean;
  message?: string;

  // if present, we can decide whether to show the "+" (only when not already in inventory)
  sku?: string;
  inInventory?: boolean;

  asin?: string;
  title?: string;
  imageUrl?: string;

  price?: { amount: number; currency: string } | null;
  bsr?: number | null;
  categoryHint?: string | null;

  estMonthlySales?: number | null;
};

function splitEans(input: string): string[] {
  const raw = input
    .split(/[\n,\t\r ]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return raw.map((s) => s.replace(/[^\d]/g, "")).filter(Boolean);
}

function flagMid(mid: string): string {
  if (mid === "A1F83G8C2ARO7P") return "UK";
  if (mid === "A1PA6795UKMFR9") return "DE";
  return mid.slice(0, 6);
}

const MARKETPLACES: { id: string; code: string; label: string }[] = [
  { id: "A1F83G8C2ARO7P", code: "UK", label: "United Kingdom" },
  // EU (common)
  { id: "A1PA6795UKMFR9", code: "DE", label: "Germany" },
  { id: "A13V1IB3VIYZZH", code: "FR", label: "France" },
  { id: "APJ6JRA9NG5V4", code: "IT", label: "Italy" },
  { id: "A1RKKUPIHCS9HS", code: "ES", label: "Spain" },
  { id: "A1805IZSGTT6HS", code: "NL", label: "Netherlands" },
  { id: "AMEN7PMS3EDWL", code: "SE", label: "Sweden" },
  { id: "A2NODRKZP88ZB9", code: "PL", label: "Poland" },
  { id: "A1C3SOZRARQ6R3", code: "BE", label: "Belgium" },
  { id: "A28R8C7NBKEWEA", code: "TR", label: "Turkey" },
];

function invId(marketplaceId: string, sku: string) {
  return `${marketplaceId}#${sku}`;
}

export default function NewProductsSearchModule() {
  const [input, setInput] = useState("");
  const [selectedMarketplaceIds, setSelectedMarketplaceIds] = useState<string[]>(["A1F83G8C2ARO7P"]); // UK default

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
const [rows, setRows] = useState<ScanRow[]>([]);
const [retryingKey, setRetryingKey] = useState<string | null>(null);

function rowKey(r: Pick<ScanRow, "ean" | "marketplaceId">) {
  return `${r.marketplaceId}#${r.ean}`;
}

  const eans = useMemo(() => splitEans(input), [input]);

  async function runScan() {
    setLoading(true);
    setErr(null);
    try {
      const marketplaceIds = selectedMarketplaceIds;

      const body: any = { eans };
      if (marketplaceIds.length) body.marketplaceIds = marketplaceIds;

      const r = await fetch("/api/new-lines/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      const rawRows: ScanRow[] = Array.isArray(j.rows) ? j.rows : [];

      // mark rows that already exist in our Inventory table (so we can hide the "+")
      // best-effort: if anything fails, we still show results, just without the inventory flag.
      let augmented = rawRows;
      try {
        const keys = rawRows
  .filter((x) => x.ok && x.asin)
  .map((x) => ({ marketplaceId: String(x.marketplaceId), asin: String(x.asin) }))
  .slice(0, 250);

if (keys.length) {
  const r2 = await fetch("/api/new-products/has-inventory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  const j2 = await r2.json().catch(() => ({}));

  // expects: { existsByKey: { "<mid>#<asin>": true/false } }
  const existsByKey: Record<string, boolean> = (j2?.existsByKey ?? {}) as any;

  augmented = rawRows.map((x) => {
    if (!x.ok || !x.asin) return { ...x, inInventory: false };
    const k = `${String(x.marketplaceId)}#${String(x.asin)}`;
    return { ...x, inInventory: Boolean(existsByKey[k]) };
  });
}
      } catch {
        // ignore
      }

      setRows(augmented);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function retryOne(row: ScanRow) {
  const key = rowKey(row);
  setRetryingKey(key);
  setErr(null);

  try {
    const body: any = { eans: [row.ean], marketplaceIds: [row.marketplaceId] };

    const r = await fetch("/api/new-lines/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

    const newRow = Array.isArray(j.rows) ? j.rows[0] : null;
    if (!newRow) throw new Error("No row returned");

    // Replace just this row in-place
    setRows((prev) =>
      prev.map((x) => (rowKey(x) === key ? (newRow as ScanRow) : x))
    );
  } catch (e: any) {
    setErr(e?.message || String(e));
  } finally {
    setRetryingKey(null);
  }
}

  function addToInvestigate(row: ScanRow) {
    alert(`Add to Investigate: ${row.ean} (${flagMid(row.marketplaceId)})`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New Products â€¢ Search</h1>
          <p className="text-white/60">
            Paste EANs to scan UK/EU catalog, estimate sales + profit (STK-style cache-first).
          </p>
        </div>

        <button
          onClick={runScan}
          disabled={loading || eans.length === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
          Run scan
        </button>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
  <div className="flex items-center justify-between gap-3">
    <div className="text-sm font-semibold">Marketplaces</div>
    <div className="text-xs text-white/60">UK is ticked by default. You can select multiple.</div>
  </div>

  <div className="flex flex-wrap gap-2">
    {MARKETPLACES.map((m) => {
      const checked = selectedMarketplaceIds.includes(m.id);
      return (
        <label
  key={`${m.code}-${m.id}`}
  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm cursor-pointer select-none transition
    ${checked ? "border-white/30 bg-white/10" : "border-white/10 bg-black/20 hover:bg-black/30"}`}
>
  <input
    type="checkbox"
    checked={checked}
    onChange={(e) => {
      const next = new Set(selectedMarketplaceIds);
      if (e.target.checked) next.add(m.id);
      else next.delete(m.id);
      const arr = Array.from(next);
      setSelectedMarketplaceIds(arr.length ? arr : ["A1F83G8C2ARO7P"]);
    }}
    className="hidden"
  />
  <span className="text-sm font-medium text-white">{m.code}</span>
</label>
      );
    })}
  </div>

  <div className="text-xs text-white/60">
    Later: persist this via <span className="text-white/80">AppSettings.newLinesMarketplaceIdsJson</span>.
  </div>

  <div className="pt-2 border-t border-white/10 space-y-2">
    <div className="text-sm font-semibold">EANs</div>
    <textarea
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder={`Paste EANs (comma/newline separated)\nExample: 5034533013690`}
      rows={6}
      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
    />
    <div className="text-xs text-white/60">
      Parsed: <span className="text-white/80">{eans.length}</span>
    </div>
  </div>
</div>

      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-4 py-3 text-sm font-semibold border-b border-white/10">Results</div>

        <div className="divide-y divide-white/10">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-white/60">No results yet.</div>
          ) : (
            rows.map((r, idx) => (
              <div key={`${r.ean}-${r.marketplaceId}-${idx}`} className="px-4 py-3 flex gap-3 items-center">
                <div className="h-12 w-12 shrink-0 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-white/60">
                    <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5">{flagMid(r.marketplaceId)}</span>
                    {r.sku ? (
                      <>
                        <span className="text-white/50">SKU</span>
                        <span className="text-white/80">{r.sku}</span>
                      </>
                    ) : null}
                    <span className="text-white/50">EAN</span>
                    <span className="text-white/80">{r.ean}</span>
                    {r.asin ? (
                      <>
                        <span className="text-white/50">ASIN</span>
                        <span className="text-white/80">{r.asin}</span>
                      </>
                    ) : null}
                    {r.fromCache ? <span className="text-emerald-300/80">cache</span> : null}
                  </div>

                  <div className="truncate text-sm text-white/90">
  {r.ok ? (
    r.title || "(no title)"
  ) : retryingKey === rowKey(r) ? (
    <span className="text-amber-200">Retryingâ€¦</span>
  ) : (
    <span className="text-red-200">{r.message || "Not found"}</span>
  )}
</div>

                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-white/60">
                    <span>BSR: {r.bsr ?? "â€”"}</span>
                    <span>Sales/mo: {r.estMonthlySales ?? "â€”"}</span>
                  </div>
                </div>

               <div className="shrink-0">
  {r.ok ? (
    <button
      onClick={() => addToInvestigate(r)}
      disabled={Boolean(r.inInventory)}
      className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
      title={r.inInventory ? "Already in inventory" : "Add to Investigate"}
    >
      <Plus className="h-4 w-4" />
    </button>
  ) : (
    <button
      onClick={() => retryOne(r)}
      disabled={retryingKey === rowKey(r)}
      className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
      title="Retry this EAN"
    >
      <RefreshCw className={`h-4 w-4 ${retryingKey === rowKey(r) ? "animate-spin" : ""}`} />
    </button>
  )}
</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}