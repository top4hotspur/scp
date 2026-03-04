//app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
//import { CostHud } from "@/components/cost/CostHud";
//import { ViewerHeartbeat } from "@/components/viewer/ViewerHeartbeat";
import { AppShell } from "@/components/shell/AppShell";
import { DockProvider } from "@/components/dock/DockProvider";
import { Amplify } from "aws-amplify";
import outputs from "@/amplify_outputs.json";

Amplify.configure(outputs);

export const metadata: Metadata = {
  title: "SCP",
  description: "Seller Cockpit (STK-mode)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        {/* Active Viewer Gate heartbeat */}
    {/*    <ViewerHeartbeat />*/}

        {/* IDE-style shell (left nav + dock area) */}
        <DockProvider>
        <AppShell>{children}</AppShell>
        </DockProvider>

        {/* Terminal-style cost HUD (global) */}
     {/*   <CostHud />*/}
      </body>
    </html>
  );
}