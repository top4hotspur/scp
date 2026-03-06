"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";

const PUBLIC_PATHS = ["/login"];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"checking" | "authed" | "guest">("checking");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        ensureAmplifyConfigured();
        await getCurrentUser();

        if (cancelled) return;
        setStatus("authed");
      } catch {
        if (cancelled) return;
        setStatus("guest");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (status === "checking") return;

    const isPublic = PUBLIC_PATHS.includes(pathname);

    if (status === "guest" && !isPublic) {
      router.replace("/login");
      return;
    }

    if (status === "authed" && pathname === "/login") {
      router.replace("/mi/overview");
    }
  }, [status, pathname, router]);

  if (status === "checking") {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="text-sm text-neutral-400">Checking session…</div>
      </div>
    );
  }

  if (status === "guest" && !PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  return <>{children}</>;
}