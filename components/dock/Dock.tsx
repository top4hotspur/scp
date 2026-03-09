//components/dock/Dock.tsx
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, Columns2 } from "lucide-react";
import { useDock } from "./DockProvider";
import SettingsUploads from "@/components/pages/SettingsUploads";
import SettingsApp from "@/components/pages/SettingsApp";

function normalizeHref(href: string): string {
  const h = String(href ?? "").trim();
  if (!h) return "/";
  return h.startsWith("/") ? h : `/${h}`;
}

function DocRenderer({ href, children }: { href: string; children?: React.ReactNode }) {
  const pathname = normalizeHref(usePathname() || "/");

  // If this tab matches the current route, render the real Next.js page content
  if (normalizeHref(href) === pathname) {
    return <>{children}</>;
  }

  // Settings (these are non-page components in your project)
  if (normalizeHref(href) === "/settings/uploads") return <SettingsUploads />;
  if (normalizeHref(href) === "/settings/app") return <SettingsApp />;

  // Otherwise: route mismatch (tab is not on-screen route yet)
  return (
    <div className="p-4 text-sm text-white/60">
      This tab is not active on the current route. Click the tab to navigate.
    </div>
  );
}
function Pane({ target, children }: { target: "left" | "right"; children?: React.ReactNode }) {
  const { state, closeDoc, setActive, openDoc } = useDock();
  const pathname = normalizeHref(usePathname() || "/");
  const router = useRouter();
  const pane = target === "left" ? state.left : state.right;
    useEffect(() => {
    // Only auto-open in the LEFT pane
    if (target !== "left") return;

    // If no tabs are open, open the current route as a tab.
    if (pane.tabs.length === 0 && pathname) {
      // Make a human title for common routes
      const title =
        pathname === "/settings/uploads"
          ? "Up&Downloads"
          : pathname === "/"
          ? "Overview"
          : pathname;

      openDoc({ title, href: pathname }, "left");
      // We don't know the internal id openDoc generates, so we rely on Pane fallback to first tab.
      // (active is pane.tabs[0] if activeId doesn't match)
    }
  }, [target, pathname, pane.tabs.length, openDoc]);
  const active = pane.tabs.find((t) => t.id === pane.activeId) ?? pane.tabs[0] ?? null;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 bg-black/20 px-2 py-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {pane.tabs.length === 0 && (
            <div className="px-2 text-xs text-white/50">No tabs open</div>
          )}

          {pane.tabs.map((t) => {
            const isActive = t.id === (active?.id ?? null);
            return (
              <button
                key={t.id}
                onClick={() => {
  setActive(t.id, target);
  router.push(normalizeHref(t.href));
}}
                className={[
                  "flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs whitespace-nowrap",
                  "border",
                  isActive
                    ? "bg-white/10 border-white/15 text-white"
                    : "bg-transparent border-transparent text-white/60 hover:bg-white/5 hover:border-white/10",
                ].join(" ")}
              >
                <span>{t.title}</span>
                <span
                  className="opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDoc(t.id, target);
                  }}
                  title="Close"
                >
                  <X size={14} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {active ? (
  <DocRenderer href={active.href}>{children}</DocRenderer>
) : (
  <div className="p-4 text-white/60">Open a module from the left menu.</div>
)}
      </div>
    </div>
  );
}

export function Dock({ children }: { children?: React.ReactNode }) {
  const { state, toggleSplit } = useDock();

  return (
    <div className="h-[calc(100vh-48px)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-white/60">Workspace</div>
          <div className="text-lg font-semibold">Dock</div>
        </div>

        <button
          onClick={toggleSplit}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
          title="Toggle split view"
        >
          <Columns2 size={16} />
          {state.split ? "Unsplit" : "Split"}
        </button>
      </div>

      <div className={state.split ? "grid grid-cols-2 gap-3 h-full" : "grid grid-cols-1 gap-3 h-full"}>
        <Pane target="left">{children}</Pane>
{state.split && <Pane target="right" />}
      </div>
    </div>
  );
}