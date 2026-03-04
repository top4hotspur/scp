/* amplify/functions/schedulerTick/handler.ts */

export const handler = async () => {
  const baseUrl = String(process.env.SCP_APP_BASE_URL ?? "").trim();
  const token = String(process.env.SCHEDULER_TOKEN ?? "").trim();

  if (!baseUrl) {
    // Minimal log, because logs are a tax.
    console.log("[schedulerTick] missing env SCP_APP_BASE_URL");
    return { ok: false, error: "Missing SCP_APP_BASE_URL" };
  }

  const url =
    token
      ? `${baseUrl.replace(/\/$/, "")}/api/inventory/scheduler/tick?token=${encodeURIComponent(token)}`
      : `${baseUrl.replace(/\/$/, "")}/api/inventory/scheduler/tick`;

  const res = await fetch(url, { method: "POST" });
  const json = await res.json().catch(() => ({} as any));

  if (!res.ok || !json?.ok) {
    console.log("[schedulerTick] tick failed", res.status, json?.error ?? "unknown");
    return { ok: false, status: res.status, error: json?.error ?? `HTTP ${res.status}` };
  }

  // Keep logs minimal & structured
  console.log("[schedulerTick] ok", {
    due: json?.due ?? [],
    ran: (json?.ran ?? []).map((x: any) => x?.key).filter(Boolean),
    skipped: json?.skipped ?? false,
    reason: json?.reason ?? null,
  });

  return { ok: true, due: json?.due ?? [], ran: json?.ran ?? [], skipped: json?.skipped ?? false };
};