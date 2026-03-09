//components/overview/LastSalesPanel.tsx
"use client";

function gbp(v: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

export default function LastSalesPanel({ rows }: { rows: any[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
      <div className="mb-4 text-sm font-semibold text-white">Last 10 Sales</div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-white/80">
          <thead>
            <tr className="border-b border-white/10 text-left text-white/50">
              <th className="pb-2 pr-3">Image</th>
              <th className="pb-2 pr-3">SKU / Product</th>
              <th className="pb-2 pr-3">Costs</th>
              <th className="pb-2 pr-3">Selling Price</th>
              <th className="pb-2 pr-3">Profit</th>
              <th className="pb-2 pr-3">UK Units</th>
              <th className="pb-2 pr-3">EU Units</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r, i) => (
              <tr key={`${r.sku}-${r.orderDateIso}-${i}`} className="border-b border-white/5">
                <td className="py-3 pr-3">
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.productName || r.sku}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-white/10" />
                  )}
                </td>

                <td className="py-3 pr-3">
                  <div className="font-medium text-white">{r.sku}</div>
                  <div className="text-white/50">{r.productName}</div>
                  {r.missingCostFields ? (
                    <div className="mt-1 text-xs text-amber-300">Costs incomplete</div>
                  ) : null}
                </td>

                <td className="py-3 pr-3">{gbp(r.totalCostGbp)}</td>
                <td className="py-3 pr-3">{gbp(r.sellingPriceGbp)}</td>

                <td
                  className={`py-3 pr-3 ${
                    Number(r.profitGbp || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {gbp(r.profitGbp)}
                </td>

                <td className="py-3 pr-3">{r.unitsRemainingUk ?? "—"}</td>
                <td className="py-3 pr-3">{r.unitsRemainingEu ?? "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}