//components/overview/SupplierRiskTable.tsx
"use client";

import { useMemo, useState } from "react";

type SortKey = "supplier" | "outOfStock" | "restock10d";

export default function SupplierRiskTable({ rows }: { rows: any[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("outOfStock");
  const [desc, setDesc] = useState(true);

  function toggle(next: SortKey) {
    if (next === sortKey) {
      setDesc((v) => !v);
      return;
    }
    setSortKey(next);
    setDesc(true);
  }

  const sorted = useMemo(() => {
    const copy = [...(rows || [])];
    copy.sort((a, b) => {
      const av = a?.[sortKey];
      const bv = b?.[sortKey];

      if (sortKey === "supplier") {
        return desc
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      }

      return desc ? Number(bv || 0) - Number(av || 0) : Number(av || 0) - Number(bv || 0);
    });
    return copy;
  }, [rows, sortKey, desc]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
      <div className="mb-4 text-sm font-semibold text-white">Supplier Stock Risk</div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-white/80">
          <thead>
            <tr className="border-b border-white/10 text-left text-white/50">
              <th className="cursor-pointer pb-2 pr-3" onClick={() => toggle("supplier")}>Supplier</th>
              <th className="cursor-pointer pb-2 pr-3" onClick={() => toggle("outOfStock")}>Out of Stock</th>
              <th className="cursor-pointer pb-2 pr-3" onClick={() => toggle("restock10d")}>Restock in 10 Days</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.supplier} className="border-b border-white/5">
                <td className="py-3 pr-3 text-white">{r.supplier}</td>
                <td className="py-3 pr-3">{r.outOfStock}</td>
                <td className="py-3 pr-3">{r.restock10d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}