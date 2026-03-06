//components/shell/AppShell.tsx
"use client";

import React, { useEffect } from "react";
import { useDock } from "@/components/dock/DockProvider";
import { Dock } from "@/components/dock/Dock";
import { usePathname, useRouter } from "next/navigation";

type NavGroup = { title: string; items: { label: string; href: string }[] };

const NAV: NavGroup[] = [
  {
    title: "MI",
    items: [
      { label: "Overview", href: "mi/overview" },
      { label: "Sales", href: "/mi/sales" },
      { label: "Restock", href: "/mi/restock" },
      { label: "Clean", href: "/mi/clean" },
      { label: "Reports", href: "/mi/reports" },
    ],
  },
  { title: "ORDERS", items: [{ label: "Management", href: "/orders/management" }] },
  {
    title: "REPRICER",
    items: [
      { label: "Strategies", href: "/repricer/strategies" },
      { label: "Strategy Mapper", href: "/repricer/mapper" },
      { label: "Status", href: "/repricer/status" },
    ],
  },
  {
    title: "NEW PRODUCTS",
    items: [
      { label: "Search", href: "/new-products/search" },
      { label: "Investigate", href: "/new-products/investigate" },
      { label: "List", href: "/new-products/list" },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      { label: "User", href: "/settings/user" },
      { label: "Up&Downloads", href: "/settings/uploads" },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { openDoc } = useDock();
  const router = useRouter();
  const pathname = usePathname();

  // Heartbeat (cheap, only while app is open)
  useEffect(() => {
    const ping = () => {
      const page = typeof window !== "undefined" ? window.location.pathname : "";
      fetch("/api/viewer/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page }),
      }).catch(() => {});
    };

    ping();
    const interval = setInterval(ping, 60_000);

    const onFocus = () => ping();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // When route changes, open it as a dock tab (so Dock isnâ€™t empty)
  useEffect(() => {
    const title = NAV.flatMap((g) => g.items).find((x) => x.href === pathname)?.label ?? pathname;
    openDoc({ title, href: pathname }, "left");
  }, [pathname, openDoc]);

  return (
    <div className="flex min-h-screen">
      <aside className="relative w-72 shrink-0 border-r border-white/10 bg-black/40 backdrop-blur-2xl">
        {/* Thin vertical gradient stripe (IDE vibe) */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-white/20 via-white/5 to-transparent opacity-70" />
        {/* Soft top glow */}
        <div className="pointer-events-none absolute -top-24 left-8 h-48 w-48 rounded-full bg-white/10 blur-3xl" />

        <div className="p-4 border-b border-white/10">
          <div className="text-sm font-semibold tracking-wide">SCP</div>
          <div className="text-xs text-white/60">STK-mode â€¢ cost locked</div>
        </div>

        <nav className="p-3 space-y-3">
          {NAV.map((g) => (
            <div key={g.title}>
              <div className="px-2 pb-1 mb-1 text-[11px] font-medium tracking-widest text-white/65 uppercase border-b border-white/10">
                {g.title}
              </div>

              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <button
                    key={it.href}
                    onClick={() => {
                      openDoc({ title: it.label, href: it.href }, "left");
                      router.push(it.href);
                    }}
                    className={[
                      "w-full text-left block rounded-lg px-4 py-1.5 text-sm",
                      "border border-transparent text-white/80",
                      "hover:bg-white/5 hover:border-white/10",
                    ].join(" ")}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1">
  <div className="p-6">
    <Dock>{children}</Dock>
  </div>
</main>
    </div>
  );
}