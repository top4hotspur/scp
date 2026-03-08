//app/mi/overview/page.tsx
"use client";

import { useEffect, useState } from "react";
import ProfitCard from "@/components/overview/ProfitCard";
import LastSalesPanel from "@/components/overview/LastSalesPanel";
import SupplierRiskTable from "@/components/overview/SupplierRiskTable";

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/overview/snapshot/latest", { cache: "no-store" });
      const json = await res.json();

      if (!json?.ok) {
        throw new Error(json?.error || "Failed to load overview snapshot");
      }

      setSnapshot(json.snapshot);
      setCards(json.cards);
    } catch (err: any) {
      setError(err?.message || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function rebuild() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/overview/build-snapshot", {
        method: "POST",
      });
      const json = await res.json();

      if (!json?.ok) {
        throw new Error(json?.error || "Failed to rebuild overview snapshot");
      }

      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to rebuild snapshot");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Overview</h1>
          <p className="text-sm text-white/50">Snapshot-first MI dashboard</p>
        </div>

        <button
          onClick={rebuild}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
        >
          Refresh Overview Snapshot
        </button>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-white/60">Loading overview…</div>
      ) : (
        <>
                    <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "16px",
              alignItems: "stretch",
            }}
          >
            <ProfitCard
              title="Profit Today"
              value={cards?.today?.value || 0}
              salesTotal={cards?.today?.salesTotal || 0}
              deltaPct={null}
            />
            <ProfitCard
              title="Profit Yesterday"
              value={cards?.yesterday?.value || 0}
              salesTotal={cards?.yesterday?.salesTotal || 0}
              deltaPct={cards?.yesterday?.deltaPct ?? null}
            />
            <ProfitCard
              title="Profit Last 7 Days"
              value={cards?.d7?.value || 0}
              salesTotal={cards?.d7?.salesTotal || 0}
              deltaPct={cards?.d7?.deltaPct ?? null}
            />
            <ProfitCard
              title="Profit Last 30 Days"
              value={cards?.d30?.value || 0}
              salesTotal={cards?.d30?.salesTotal || 0}
              deltaPct={cards?.d30?.deltaPct ?? null}
            />
          </div>

          <LastSalesPanel rows={snapshot?.last10SalesJson || []} />

          <SupplierRiskTable rows={snapshot?.supplierRiskJson || []} />
        </>
      )}
    </div>
  );
}