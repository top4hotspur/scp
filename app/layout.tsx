// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import AuthGate from "@/components/AuthGate";
import { AppShell } from "@/components/shell/AppShell";
import { DockProvider } from "@/components/dock/DockProvider";

export const metadata: Metadata = {
  title: "SCP",
  description: "Seller Cockpit (STK-mode)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <DockProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </DockProvider>
      </body>
    </html>
  );
}