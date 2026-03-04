// app/mi/restock/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Minus, ChevronDown, ChevronUp } from "lucide-react";

type RestockSnap = {
  marketplaceId: string;
  bucket: string;
  createdAtIso: string;
  status: string;
  message?: string;
  skus: number;
  availableUnits: number;
  inboundUnits: number;
  reservedUnits: number;
};

type RestockOptions = {
  ok: boolean;
  suppliers: string[];
  productGroups: { pg1: string[]; pg2: string[]; pg3: string[]; pg4: string[]; pg5: string[] };
  error?: string;
};

type RestockRow = {
  sku: string;
  shortTitle?: string | null;

  // these may be “suggested” numbers from restock table
  available: number;
  inbound: number;

  projectedBalance: number;
  daysOfCover: number | null;
  daysToOrder: number | null;

  unitCost: number;
  soldUnits: number; // <-- we’ll display this as “Sales”
  dailyVel: number;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtIso(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return iso;
  }
}

function fmtNum(v: any, d = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function fmtInt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return String(Math.trunc(n));
}

function fmtMoney(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function normSku(s: any) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

async function loadStockMapsFromAvailability(mid: string, skus: string[]) {
  const want = skus.map(normSku).filter(Boolean).slice(0, 800);
  if (!want.length) return { avail: {}, inbound: {} };

  const r = await fetch(
    `/api/inventory/availability?mid=${encodeURIComponent(mid)}&skus=${encodeURIComponent(want.join(","))}`,
    { cache: "no-store" }
  );
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

  const avail = (j.availability ?? {}) as Record<string, number>;
  const inbound = (j.inbound ?? {}) as Record<string, number>;

  // Normalize keys
  const outAvail: Record<string, number> = {};
  const outInbound: Record<string, number> = {};

  for (const k of Object.keys(avail)) outAvail[normSku(k)] = Number(avail[k] ?? 0) || 0;
  for (const k of Object.keys(inbound)) outInbound[normSku(k)] = Number(inbound[k] ?? 0) || 0;

  // Also: normalize requested keys into response shape (guards against exact-key mismatch)
  for (const k of want) {
    if (outAvail[k] == null) outAvail[k] = 0;
    if (outInbound[k] == null) outInbound[k] = 0;
  }

  return { avail: outAvail, inbound: outInbound };
}

type SortKey = "avail" | "inbound" | "sales" | "projectedBalance" | "daysOfCover" | "daysToOrder";
type SortDir = "asc" | "desc";
const DRAFT_SUFFIX = "active";

type DraftLine = {
  sku: string;
  qty: number;
};

export default function Page() {
  const [mid, setMid] = useState<string>("A1F83G8C2ARO7P");
  const [mids, setMids] = useState<Array<{ mid: string; name: string }>>([
    { mid: "A1F83G8C2ARO7P", name: "UK" },
  ]);

  const [snap, setSnap] = useState<RestockSnap | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draftQtyByKey, setDraftQtyByKey] = useState<Record<string, string>>({});
  const [addedQtyByKey, setAddedQtyByKey] = useState<Record<string, number>>({});
  const [busyByKey, setBusyByKey] = useState<Record<string, boolean>>({});
  const [stockAvailBySku, setStockAvailBySku] = useState<Record<string, number>>({});
  const [stockInboundBySku, setStockInboundBySku] = useState<Record<string, number>>({});

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<string>("");

  const [pg1, setPg1] = useState<string>("");
  const [pg2, setPg2] = useState<string>("");
  const [pg3, setPg3] = useState<string>("");
  const [pg4, setPg4] = useState<string>("");
  const [pg5, setPg5] = useState<string>("");

  const [pgOptions, setPgOptions] = useState<RestockOptions["productGroups"]>({
    pg1: [],
    pg2: [],
    pg3: [],
    pg4: [],
    pg5: [],
  });

  const [days, setDays] = useState<30 | 60 | 90>(30);

  const [rows, setRows] = useState<RestockRow[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableErr, setTableErr] = useState<string | null>(null);

    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  function lineKey(mid2: string, sku: string) {
    return `${mid2}#${sku}`.toUpperCase();
  }

  async function upsertDraftLine(params: { mid: string; supplier: string; sku: string; qty: number }) {
  const res = await fetch("/api/purchase-orders/upsert-line", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mid: params.mid,
      supplier: params.supplier,
      draftSuffix: DRAFT_SUFFIX,
      sku: params.sku,
      qty: params.qty,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

async function loadDraftLines(params: { mid: string; supplier: string }) {
  const res = await fetch(
    `/api/purchase-orders/draft?mid=${encodeURIComponent(params.mid)}&supplier=${encodeURIComponent(
      params.supplier
    )}&suffix=${encodeURIComponent(DRAFT_SUFFIX)}`,
    { cache: "no-store" }
  );

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

  const lines = (json?.lines ?? []) as DraftLine[];
  return lines;
}

  function toIntOrZero(s: string) {
    const n = Math.trunc(Number(String(s ?? "").trim()));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

    function toggleSort(key: SortKey) {
    // first click => DESC, second click => ASC, one active at a time
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "desc" };
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  }

    function sortIcon(key: SortKey) {
    if (!sort || sort.key !== key) return <ChevronUp className="h-4 w-4 opacity-20 rotate-180" />; // faint “inactive”
    return sort.dir === "desc" ? (
      <ChevronDown className="h-4 w-4 opacity-90" />
    ) : (
      <ChevronUp className="h-4 w-4 opacity-90" />
    );
  }

  const orderSummary = useMemo(() => {
    const prefix = `${mid}#`.toUpperCase();

    let orderUnits = 0;
    let linesCount = 0;
    let orderValue = 0;

    const costBySku = new Map<string, number>();
    for (const r of rows) costBySku.set(normSku(r.sku), Number(r.unitCost ?? 0));

    for (const k of Object.keys(addedQtyByKey)) {
      if (!k.startsWith(prefix)) continue;
      const q = Number(addedQtyByKey[k] ?? 0);
      if (!(q > 0)) continue;

      linesCount += 1;
      orderUnits += q;

      const sku = normSku(k.slice(prefix.length));
      const unitCost = costBySku.get(sku) ?? 0;
      orderValue += q * unitCost;
    }

    const orderProfit = null as number | null;
    return { orderUnits, orderValue, orderProfit, lines: linesCount };
  }, [addedQtyByKey, mid, rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/restock/snapshot?mid=${encodeURIComponent(mid)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSnap(json.snapshot ?? null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setSnap(null);
    } finally {
      setLoading(false);
    }
  }, [mid]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings/app", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as any;
        if (!r.ok || !j?.ok) return;

        const s = j.settings ?? {};
        const uk = String(s.ukMarketplaceId ?? "A1F83G8C2ARO7P");
        const euJson = String(s.euMarketplaceIdsJson ?? "[]");

        let euMids: string[] = [];
        try {
          const arr = JSON.parse(euJson);
          euMids = Array.isArray(arr) ? arr.map(String).map((x) => x.trim()).filter(Boolean) : [];
        } catch {
          euMids = [];
        }

        const nameByMid: Record<string, string> = {
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

        const list = [
          { mid: uk, name: nameByMid[uk] ?? "United Kingdom" },
          ...euMids.filter((x) => x && x !== uk).map((x) => ({ mid: x, name: nameByMid[x] ?? "EU Marketplace" })),
        ];

        setMids(list);
        if (!list.find((x) => x.mid === mid)) setMid(list[0]?.mid ?? uk);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadOptions = useCallback(
    async (forSupplier?: string) => {
      setOptionsLoading(true);
      try {
        const s = (forSupplier ?? supplier).trim();
        const url = s ? `/api/restock/options?supplier=${encodeURIComponent(s)}` : `/api/restock/options`;
        const r = await fetch(url, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as RestockOptions;
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

        setSuppliers(Array.isArray(j.suppliers) ? j.suppliers : []);
        setPgOptions(j.productGroups ?? { pg1: [], pg2: [], pg3: [], pg4: [], pg5: [] });

        if (!supplier && j.suppliers?.length) setSupplier(j.suppliers[0]);
      } catch (e: any) {
        console.warn("restock options load failed", e?.message ?? e);
      } finally {
        setOptionsLoading(false);
      }
    },
    [supplier]
  );

  useEffect(() => {
    loadOptions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
  if (!supplier) return;
  setPg1(""); setPg2(""); setPg3(""); setPg4(""); setPg5("");
  loadOptions(supplier);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [supplier]);

  const loadTable = useCallback(async () => {
    setTableLoading(true);
    setTableErr(null);
    try {
      const s = supplier.trim();
      if (!s) throw new Error("Choose a supplier.");

      const url =
        `/api/restock/table?mid=${encodeURIComponent(mid)}` +
        `&supplier=${encodeURIComponent(s)}` +
        `&days=${encodeURIComponent(String(days))}` +
        (pg1 ? `&pg1=${encodeURIComponent(pg1)}` : "") +
        (pg2 ? `&pg2=${encodeURIComponent(pg2)}` : "") +
        (pg3 ? `&pg3=${encodeURIComponent(pg3)}` : "") +
        (pg4 ? `&pg4=${encodeURIComponent(pg4)}` : "") +
        (pg5 ? `&pg5=${encodeURIComponent(pg5)}` : "");

      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      const nextRows = (Array.isArray(j.rows) ? j.rows : []) as RestockRow[];
      setRows(nextRows);

      // Overlay stock from the working endpoint (InventorySku truth)
      try {
        const skus = nextRows.map((x) => normSku(x?.sku)).filter(Boolean).slice(0, 800);
        if (!skus.length) {
          setStockAvailBySku({});
          setStockInboundBySku({});
        } else {
          const maps = await loadStockMapsFromAvailability(mid, skus);
          setStockAvailBySku(maps.avail);
          setStockInboundBySku(maps.inbound);
        }
      } catch (e) {
        console.warn("[restock] availability exception", e);
        setStockAvailBySku({});
        setStockInboundBySku({});
      }
    } catch (e: any) {
      setTableErr(String(e?.message ?? e));
      setRows([]);
      setStockAvailBySku({});
      setStockInboundBySku({});
    } finally {
      setTableLoading(false);
    }
  }, [mid, supplier, days, pg1, pg2, pg3, pg4, pg5]);

  useEffect(() => {
  if (!supplier) return;

  // Load table rows
  loadTable();

  // Load current draft PO lines so Restock reflects Management
  (async () => {
    try {
      const lines = await loadDraftLines({ mid, supplier });

      const nextAdded: Record<string, number> = {};
      for (const ln of lines) {
        const sku = normSku((ln as any)?.sku);
        const qty = Number((ln as any)?.qty ?? 0) || 0;
        if (!sku || qty <= 0) continue;
        nextAdded[lineKey(mid, sku)] = qty;
      }

      setAddedQtyByKey(nextAdded);
    } catch (e) {
      // If there's no draft yet, that's fine
      setAddedQtyByKey({});
    }
  })();
}, [supplier, mid, days, pg1, pg2, pg3, pg4, pg5, loadTable]);

  // Display helpers (use overlay first, then fall back)
  function getAvail(r: RestockRow) {
    const k = normSku(r.sku);
    const v = stockAvailBySku[k];
    return Number.isFinite(Number(v)) ? Number(v) : Number(r.available ?? 0) || 0;
  }
  function getInbound(r: RestockRow) {
    const k = normSku(r.sku);
    const v = stockInboundBySku[k];
    return Number.isFinite(Number(v)) ? Number(v) : Number(r.inbound ?? 0) || 0;
  }
  function getSales(r: RestockRow) {
    return Number(r.soldUnits ?? 0) || 0;
  }

    const sortedRows = useMemo(() => {
    if (!sort) return rows;

    const dir = sort.dir === "desc" ? -1 : 1;

    const val = (r: RestockRow): number => {
      switch (sort.key) {
        case "avail":
          return getAvail(r);
        case "inbound":
          return getInbound(r);
        case "sales":
          return getSales(r);
        case "projectedBalance":
          return Number(r.projectedBalance ?? 0) || 0;
        case "daysOfCover": {
  const n = Number(r.daysOfCover);
  return r.daysOfCover == null || !Number.isFinite(n) ? Number.POSITIVE_INFINITY : n;
}
case "daysToOrder": {
  const n = Number(r.daysToOrder);
  return r.daysToOrder == null || !Number.isFinite(n) ? Number.POSITIVE_INFINITY : n;
}
        default:
          return 0;
      }
    };

    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av === bv) return 0;
      return av < bv ? -1 * dir : 1 * dir;
    });
    }, [rows, sort, stockAvailBySku, stockInboundBySku]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
            <div className="shrink-0 space-y-4"></div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">MI • Restock</h1>
          <p className="text-white/60">Snapshot-first + supplier-driven restock planning (no SP-API calls from UI).</p>
          <p className="text-xs text-white/60 mt-1">
            Snapshot: {snap?.status ?? "—"} · {fmtIso(snap?.createdAtIso)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={mid}
            onChange={(e) => setMid(e.target.value)}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm"
            disabled={loading}
          >
            {mids.map((x) => (
              <option key={x.mid} value={x.mid}>
                {x.name}
              </option>
            ))}
          </select>

          <button
            onClick={load}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm flex items-center gap-2"
            disabled={loading}
            title="Reload Restock snapshot"
          >
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">{err}</div> : null}

      {/* Snapshot tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile label="SKUs" value={snap?.skus ?? 0} />
        <Tile label="Available Units" value={snap?.availableUnits ?? 0} />
        <Tile label="Inbound Units" value={snap?.inboundUnits ?? 0} />
        <Tile label="Reserved Units" value={snap?.reservedUnits ?? 0} />
      </div>
            

      {/* Planner card */}
     <div className="flex-1 min-h-0 rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col gap-3">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <div className="text-xs text-white/60">Supplier</div>
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="min-w-[280px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              disabled={optionsLoading}
            >
              {suppliers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <PgSelect label="PG1" value={pg1} setValue={setPg1} options={pgOptions.pg1} />
          <PgSelect label="PG2" value={pg2} setValue={setPg2} options={pgOptions.pg2} />
          <PgSelect label="PG3" value={pg3} setValue={setPg3} options={pgOptions.pg3} />
          <PgSelect label="PG4" value={pg4} setValue={setPg4} options={pgOptions.pg4} />
          <PgSelect label="PG5" value={pg5} setValue={setPg5} options={pgOptions.pg5} />

          <div className="ml-auto flex items-center gap-3">


  <span className="text-xs text-white/60">Horizon</span>
  <HorizonButton active={days === 30} onClick={() => setDays(30)} label="30d" />
  <HorizonButton active={days === 60} onClick={() => setDays(60)} label="60d" />
  <HorizonButton active={days === 90} onClick={() => setDays(90)} label="90d" />

  <button
    onClick={loadTable}
    disabled={tableLoading || !supplier}
    className="ml-2 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
  >
    <RefreshCw className={cx("h-4 w-4", tableLoading && "animate-spin")} />
    Recalc
  </button>
</div>
        </div>

        {/* Order summary as a single horizontal bar */}
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Order Units" value={orderSummary.orderUnits} />
            <Metric label="Order Value" value={fmtMoney(orderSummary.orderValue)} />
            <Metric label="Order Profit" value={orderSummary.orderProfit == null ? "—" : fmtMoney(orderSummary.orderProfit)} />
            <Metric label="Lines" value={orderSummary.lines} />
          </div>
        </div>

        {tableErr ? <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm">{tableErr}</div> : null}

       {/* Table area (the ONLY vertical scroller in this card) */}
<div className="flex-1 min-h-0 rounded-2xl border border-white/10 overflow-hidden">
  <div className="h-full overflow-auto">
    <table className="min-w-[1250px] w-full text-sm border-separate border-spacing-0">
      <thead className="text-white/80">
        <tr>
          <th className="sticky top-0 z-30 bg-[#121214] border-b border-white/10 px-3 py-2 text-left font-semibold whitespace-nowrap">
            SKU
          </th>
          <th className="sticky top-0 z-30 bg-[#121214] border-b border-white/10 px-3 py-2 text-left font-semibold whitespace-nowrap">
            Short title
          </th>

          <SortableTh label="Avail" onClick={() => toggleSort("avail")} icon={sortIcon("avail")} />
          <SortableTh label="Inbound" onClick={() => toggleSort("inbound")} icon={sortIcon("inbound")} />
          <SortableTh label="Sales" onClick={() => toggleSort("sales")} icon={sortIcon("sales")} />
          <SortableTh
            label="Projected bal"
            onClick={() => toggleSort("projectedBalance")}
            icon={sortIcon("projectedBalance")}
          />
          <SortableTh label="Days cover" onClick={() => toggleSort("daysOfCover")} icon={sortIcon("daysOfCover")} />
          <SortableTh label="Days to order" onClick={() => toggleSort("daysToOrder")} icon={sortIcon("daysToOrder")} />

          <th className="sticky top-0 z-30 bg-[#121214] border-b border-white/10 px-3 py-2 text-right font-semibold whitespace-nowrap">
            Buy qty
          </th>
          <th className="sticky top-0 z-30 bg-[#121214] border-b border-white/10 px-3 py-2 text-right font-semibold whitespace-nowrap">
            Add
          </th>
        </tr>
      </thead>

      <tbody>
        {sortedRows.map((r) => {
          const k = lineKey(mid, r.sku);
          const added = Number(addedQtyByKey[k] ?? 0);
          const isIn = added > 0;
          const draft = draftQtyByKey[k] ?? (isIn ? String(added) : "");

          const avail = getAvail(r);
          const inbound = getInbound(r);
          const sales = getSales(r);

          return (
            <tr key={k} className="border-t border-white/5">
              <td className="px-3 py-2 font-medium whitespace-nowrap">{r.sku}</td>
              <td className="px-3 py-2">{r.shortTitle ?? "—"}</td>

              <td className="px-3 py-2 text-right">{fmtInt(avail)}</td>
              <td className="px-3 py-2 text-right">{fmtInt(inbound)}</td>
              <td className="px-3 py-2 text-right">{fmtInt(sales)}</td>

              <td className="px-3 py-2 text-right">{fmtInt(r.projectedBalance)}</td>
              <td className="px-3 py-2 text-right">{r.daysOfCover == null ? "—" : fmtInt(r.daysOfCover)}</td>
              <td className="px-3 py-2 text-right">{r.daysToOrder == null ? "—" : fmtInt(r.daysToOrder)}</td>

              <td className="px-3 py-2 text-right">
                <input
                  value={draft}
                  onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
  }
}}
                  onFocus={(e) => {
                    if ((draftQtyByKey[k] ?? "") === "0") setDraftQtyByKey((p) => ({ ...p, [k]: "" }));
                    requestAnimationFrame(() => e.currentTarget.select());
                  }}
                  onChange={(e) => {
                    const raw = String(e.target.value ?? "");
                    const cleaned = raw.replace(/[^\d]/g, "");
                    setDraftQtyByKey((p) => ({ ...p, [k]: cleaned }));
                  }}
                  className="w-[110px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none text-right"
                  inputMode="numeric"
                />
              </td>

              <td className="px-3 py-2 text-right">
                <button
  type="button"
  disabled={!!busyByKey[k]}
  onClick={async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const s = supplier.trim();
  if (!s) return;
  if (busyByKey[k]) return;

  setBusyByKey((p) => ({ ...p, [k]: true }));

  const sku = normSku(r.sku);

  try {
    if (isIn) {
      // optimistic remove
      setAddedQtyByKey((p) => {
        const next = { ...p };
        delete next[k];
        return next;
      });
      setDraftQtyByKey((p) => ({ ...p, [k]: "" }));

      await upsertDraftLine({ mid, supplier: s, sku, qty: 0 });
      return;
    }

    const n = toIntOrZero(draft);
    if (n <= 0) return;

    // optimistic add
    setAddedQtyByKey((p) => ({ ...p, [k]: n }));

    await upsertDraftLine({ mid, supplier: s, sku, qty: n });
  } catch (err) {
    // revert to “not added” if anything fails
    setAddedQtyByKey((p) => {
      const next = { ...p };
      delete next[k];
      return next;
    });
  } finally {
    setBusyByKey((p) => ({ ...p, [k]: false }));
  }
}}
                  className={cx(
  "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm disabled:opacity-50",
                    isIn
                      ? "border-red-400/20 bg-red-500/10 hover:bg-red-500/15"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  )}
                  title={isIn ? "Remove from draft order" : "Add to draft order"}
                >
                  {isIn ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </button>
              </td>
            </tr>
          );
        })}

        {!rows.length && (
          <tr>
            <td colSpan={10} className="px-3 py-6 text-white/60">
              {tableLoading ? "Loading…" : "No rows yet. Choose a supplier."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>

        <div className="text-xs text-white/60">
          Next: wire +/– to create/update/remove lines in <span className="text-white/80">Orders → Management</span>{" "}
          (draft orders per supplier + marketplace).
        </div>

        <div className="text-xs opacity-60">
          Note: Projected bal / Days cover / Days to order come from <span className="text-white/80">/api/restock/table</span>.
          Stock shown in Avail/Inbound comes from <span className="text-white/80">/api/inventory/availability</span> (InventorySku truth).
        </div>
      </div>
    </div>
  );
}

function Tile(props: { label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs opacity-70">{props.label}</div>
      <div className="text-sm font-medium">{props.value}</div>
    </div>
  );
}

function Metric(props: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-white/60">{props.label}</div>
      <div className="text-sm font-medium">{props.value}</div>
    </div>
  );
}

function SortableTh(props: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <th className="sticky top-0 z-30 bg-[#121214] px-3 py-2 text-right font-semibold whitespace-nowrap">
      <button
        type="button"
        onClick={props.onClick}
        className="inline-flex items-center justify-end gap-1 w-full hover:text-white"
        title="Sort"
      >
        <span>{props.label}</span>
        {props.icon}
      </button>
    </th>
  );
}

function PgSelect(props: { label: string; value: string; setValue: (v: string) => void; options: string[] }) {
  return (
    <label className="space-y-1">
      <div className="text-xs text-white/60">{props.label}</div>
      <select
        value={props.value}
        onChange={(e) => props.setValue(e.target.value)}
        className="min-w-[140px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
      >
        <option value="">All</option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function HorizonButton(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={props.onClick}
      className={cx(
        "rounded-xl px-3 py-2 text-sm border",
        props.active ? "bg-white/15 border-white/20" : "bg-white/5 border-white/10 hover:bg-white/10"
      )}
      type="button"
    >
      {props.label}
    </button>
  );
}