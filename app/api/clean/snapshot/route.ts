//app/api/clean/snapshot/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data as T;
}

const LIST_STRANDED_ISSUES = /* GraphQL */ `
  query ListCleanListingIssues($limit: Int, $nextToken: String, $filter: ModelCleanListingIssueFilterInput) {
    listCleanListingIssues(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { marketplaceId sku issueType }
      nextToken
    }
  }
`;

async function listAll(query: string, rootKey: string, variables: any): Promise<any[]> {
  const out: any[] = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql<any>(query, { ...variables, limit: 1000, nextToken })) as any;
    const page = data?.[rootKey];
    const items = Array.isArray(page?.items) ? page.items : [];
    out.push(...items);
    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }

  return out;
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  try {
    if (raw === null || raw === undefined) return fallback;
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const GET_SNAPSHOT = /* GraphQL */ `
  query GetCleanListingSnapshot($marketplaceId: String!, $bucket: String!) {
    getCleanListingSnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
      total
      countsByStatusJson
    }
  }
`;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const data = await gql<any>(GET_SNAPSHOT, { marketplaceId: mid, bucket: "latest" });
    const snap = data?.getCleanListingSnapshot ?? null;

    // Overlay counts from CleanListingIssue (ALL issue types)
let issues: any[] = [];
try {
  issues = await listAll(LIST_STRANDED_ISSUES, "listCleanListingIssues", {
    filter: { marketplaceId: { eq: mid } },
  });
} catch {
  issues = [];
}

// Count issues by issueType (and unique SKU counts by issueType)
const issueCountsByType: Record<string, number> = {};
const issueSkuSetsByType: Record<string, Set<string>> = {};

for (const it of issues) {
  const t = String(it?.issueType ?? "UNKNOWN");
  issueCountsByType[t] = (issueCountsByType[t] ?? 0) + 1;

  if (!issueSkuSetsByType[t]) issueSkuSetsByType[t] = new Set<string>();
  const sku = String(it?.sku ?? "");
  if (sku) issueSkuSetsByType[t].add(sku);
}

const issueSkuCountsByType: Record<string, number> = {};
for (const [t, set] of Object.entries(issueSkuSetsByType)) issueSkuCountsByType[t] = set.size;

// Keep your existing status counts from snapshot
const baseCounts = safeJsonParse<Record<string, number>>(snap?.countsByStatusJson ?? "{}", {});

// Add overlay buckets for the UI (human-friendly)
const overlayCounts: Record<string, number> = {};
if ((issueSkuCountsByType["STRANDED"] ?? 0) > 0) overlayCounts["Fulfillment issue"] = issueSkuCountsByType["STRANDED"];
if ((issueSkuCountsByType["QUOTA_EXCEEDED"] ?? 0) > 0) overlayCounts["Rate limited"] = issueSkuCountsByType["QUOTA_EXCEEDED"];
if ((issueSkuCountsByType["ASIN_NOT_OFFERABLE"] ?? 0) > 0) overlayCounts["Blocked / inactive"] = issueSkuCountsByType["ASIN_NOT_OFFERABLE"];
if ((issueSkuCountsByType["SKU_NOT_IN_MARKETPLACE"] ?? 0) > 0) overlayCounts["Not in marketplace"] = issueSkuCountsByType["SKU_NOT_IN_MARKETPLACE"];
if ((issueSkuCountsByType["MISSING_ASIN"] ?? 0) > 0) overlayCounts["Missing ASIN"] = issueSkuCountsByType["MISSING_ASIN"];

// Optionally return a small list for the table (cap it to keep it cheap)
const issuesSample = issues.slice(0, 200);

// combinedCounts = base + overlay (overlay adds a bucket, doesn't change Active/Inactive)
const combinedCounts: Record<string, number> = { ...baseCounts };
for (const [k, v] of Object.entries(overlayCounts)) combinedCounts[k] = (combinedCounts[k] ?? 0) + (v ?? 0);

return NextResponse.json({
  ok: true,
  snapshot: snap,
  overlayCounts,
  combinedCounts,

  // NEW
  issueCountsByType,
  issueSkuCountsByType,
  issues: issuesSample,
});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

