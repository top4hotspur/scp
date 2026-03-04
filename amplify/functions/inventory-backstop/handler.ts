export const handler = async () => {
  const baseUrl = process.env.APP_BASE_URL; // set in Amplify env
  if (!baseUrl) throw new Error("Missing env var APP_BASE_URL");

  const mids = [
    process.env.UK_MARKETPLACE_ID ?? "A1F83G8C2ARO7P",
    // optionally include DE anchor for EU inventory truth
    process.env.EU_INVENTORY_MID ?? "A1PA6795UKMFR9",
  ].filter(Boolean);

  const results: any[] = [];

  for (const mid of mids) {
    const url = `${baseUrl}/api/inventory/ingest?mid=${encodeURIComponent(mid)}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    results.push({ mid, ok: res.ok, status: res.status, json });
  }

  return { ok: true, results };
};