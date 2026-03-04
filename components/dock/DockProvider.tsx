  //components/dock/DockProvider.tsx
  "use client";

  import React, { createContext, useContext, useMemo, useState } from "react";

  export type DockDoc = {
    id: string;
    title: string;
    href: string; // canonical key like "/mi/sales"
  };

  type PaneState = {
    activeId: string | null;
    tabs: DockDoc[];
  };

  type DockState = {
    split: boolean;
    left: PaneState;
    right: PaneState;
  };

  type DockApi = {
    state: DockState;
    openDoc: (doc: Omit<DockDoc, "id">, target?: "left" | "right") => void;
    closeDoc: (id: string, target: "left" | "right") => void;
    setActive: (id: string, target: "left" | "right") => void;
    toggleSplit: () => void;
  };

  const DockCtx = createContext<DockApi | null>(null);

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  export function DockProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<DockState>(() => ({
      split: false,
      left: { activeId: null, tabs: [] },
      right: { activeId: null, tabs: [] },
    }));

    const api = useMemo<DockApi>(() => {
      function openDoc(doc: Omit<DockDoc, "id">, target: "left" | "right" = "left") {
        setState((s) => {
          const pane = target === "left" ? s.left : s.right;

          // already open?
          const existing = pane.tabs.find((t) => t.href === doc.href);
          const nextDoc: DockDoc = existing ?? { ...doc, id: uid() };
          const nextTabs = existing ? pane.tabs : [nextDoc, ...pane.tabs];

          const nextPane: PaneState = { tabs: nextTabs, activeId: nextDoc.id };
          return target === "left" ? { ...s, left: nextPane } : { ...s, right: nextPane };
        });
      }

      function closeDoc(id: string, target: "left" | "right") {
        setState((s) => {
          const pane = target === "left" ? s.left : s.right;
          const nextTabs = pane.tabs.filter((t) => t.id !== id);
          const nextActive =
            pane.activeId === id ? (nextTabs[0]?.id ?? null) : pane.activeId;

          const nextPane: PaneState = { tabs: nextTabs, activeId: nextActive };
          return target === "left" ? { ...s, left: nextPane } : { ...s, right: nextPane };
        });
      }

      function setActive(id: string, target: "left" | "right") {
        setState((s) => {
          const pane = target === "left" ? s.left : s.right;
          const nextPane: PaneState = { ...pane, activeId: id };
          return target === "left" ? { ...s, left: nextPane } : { ...s, right: nextPane };
        });
      }

      function toggleSplit() {
        setState((s) => ({
          ...s,
          split: !s.split,
          // if turning on split and right is empty, seed it with a copy of the left active doc (if any)
          right:
            !s.split && s.right.tabs.length === 0 && s.left.activeId
              ? {
                  tabs: s.left.tabs.slice(0, 1),
                  activeId: s.left.tabs[0]?.id ?? null,
                }
              : s.right,
        }));
      }

      return { state, openDoc, closeDoc, setActive, toggleSplit };
    }, [state]);

    return <DockCtx.Provider value={api}>{children}</DockCtx.Provider>;
  }

  export function useDock() {
    const v = useContext(DockCtx);
    if (!v) throw new Error("useDock must be used inside DockProvider");
    return v;
  }