//components/viewer/ViewerHeartbeat.tsx
"use client";

import { useEffect, useRef } from "react";

const HEARTBEAT_MS = 60_000; // 60s
const IDLE_GRACE_MS = 10 * 60_000; // 10 min without heartbeat -> inactive

export function ViewerHeartbeat() {
  const timerRef = useRef<any>(null);

  useEffect(() => {
    async function beat() {
      try {
        await fetch("/api/viewer/heartbeat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            page: window.location.pathname,
            ts: new Date().toISOString(),
            idleGraceMs: IDLE_GRACE_MS,
          }),
        });
      } catch {
        // ignore – we don't want UI spam
      }
    }

    beat();
    timerRef.current = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  return null;
}