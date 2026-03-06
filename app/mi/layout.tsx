"use client";

import AuthGate from "@/components/AuthGate";

export default function MiLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}