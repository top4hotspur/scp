import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp = { data?: any; errors?: { message: string }[] };

async function gql(query: string, variables?: any): Promise<any> {
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": DATA_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp;

  if (!res.ok || json.errors?.length) {
    throw new Error(
      json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`
    );
  }

  return json.data ?? null;
}
  
const LIST_STRANDED_ISSUES = /* GraphQL */ `
  query ListCleanListingIssues($limit: Int, $nextToken: String, $filter: ModelCleanListingIssueFilterInput) {
    listCleanListingIssues(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items {
        marketplaceId
        sku
        issueType
      }
      nextToken
    }
  }
`;

const LIST_BY_MARKETPLACE_STATUS = /* GraphQL */ `
  query ListCleanListings($limit: Int, $nextToken: String, $filter: ModelCleanListingFilterInput) {
    listCleanListings(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items {
        marketplaceId
        sku
        asin
        title
        price
        quantity
        status
        fulfillmentChannel
        updatedAtIso
      }
      nextToken
    }
  }
`;

// CSV
function csvEscape(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows: Record<string, any>[], headers: string[]) {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) lines.push(headers.map((h) => csvEscape((r as any)[h])).join(","));
  return lines.join("\n");
}

async function listAll(query: string, rootKey: string, variables: any): Promise<any[]> {
  const out: any[] = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql(query, { ...variables, limit: 1000, nextToken })) as any;
    const page = data?.[rootKey];
    const items = Array.isArray(page?.items) ? page.items : [];
    out.push(...items);

    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }

  return out;
}

function marketplaceName(mid: string): string {
  const map: Record<string, string> = {
    A1F83G8C2ARO7P: "UK",
    A1PA6795UKMFR9: "Germany",
    A13V1IB3VIYZZH: "France",
    APJ6JRA9NG5V4: "Italy",
    A1RKKUPIHCS9HS: "Spain",
    A1805IZSGTT6HS: "Netherlands",
    AMEN7PMS3EDWL: "Belgium",
    A2NODRKZP88ZB9: "Sweden",
    A1C3SOZRARQ6R3: "Poland",
    A28R8C7NBKEWEA: "Ireland",
  };
  return map[mid] ?? mid;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    const status = String(url.searchParams.get("status") ?? "").trim();
    const download = String(url.searchParams.get("download") ?? "").trim() === "1";

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const filter: any = { marketplaceId: { eq: mid } };
    // Special bucket: "Fulfillment issue" = STRANDED overlay (not from CleanListing.status)
const statusKey = status.trim().toLowerCase().replace(/[_-]+/g, " ");
if (statusKey === "fulfillment issue") {
  const issues = await listAll(LIST_STRANDED_ISSUES, "listCleanListingIssues", {
    filter: { marketplaceId: { eq: mid }, issueType: { eq: "STRANDED" } },
  });

  if (!download) {
    return NextResponse.json({ ok: true, total: issues.length, rows: issues });
  }

  const rows = issues.map((x) => ({
    marketplace: marketplaceName(x.marketplaceId ?? ""),
    marketplaceId: x.marketplaceId ?? "",
    status: "Fulfillment issue",
    issueType: x.issueType ?? "",
    sku: x.sku ?? "",
  }));

  const headers = ["marketplace", "marketplaceId", "status", "issueType", "sku"];

  const bom = "\uFEFF";
  const csv = toCsv(rows, headers);

  const fn = `clean_${mid}__fulfillment_issue.csv`;

  return new Response(bom + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fn}"`,
    },
  });
}
    if (status) filter.status = { eq: status };

    // paginate
    const out: any[] = [];
    let nextToken: string | null = null;
    while (true) {
      const data = (await gql(LIST_BY_MARKETPLACE_STATUS, { limit: 1000, nextToken, filter })) as any;
const page = data?.listCleanListings;
      const items = Array.isArray(page?.items) ? page.items : [];
      out.push(...items);
      nextToken = page?.nextToken ?? null;
      if (!nextToken) break;
    }

    if (!download) {
      return NextResponse.json({ ok: true, total: out.length, rows: out });
    }

    const rows = out.map((x) => ({
     marketplaceId: String(x.marketplaceId ?? "").trim(),
marketplace: marketplaceName(String(x.marketplaceId ?? "").trim()),
      status: x.status ?? "",
      sku: x.sku ?? "",
      asin: x.asin ?? "",
      title: x.title ?? "",
      price: x.price ?? "",
      quantity: x.quantity ?? "",
      fulfillmentChannel: x.fulfillmentChannel ?? "",
      updatedAtIso: x.updatedAtIso ?? "",
    }));

    const headers = [
      "marketplace",
      "marketplaceId",
      "status",
      "sku",
      "asin",
      "title",
      "price",
      "quantity",
      "fulfillmentChannel",
      "updatedAtIso",
    ];

    const bom = "\uFEFF";
    const csv = toCsv(rows, headers);

    const fn = status
      ? `clean_${mid}__${status.replace(/[^a-z0-9-_]+/gi, "_")}.csv`
      : `clean_${mid}__all.csv`;

    return new Response(bom + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fn}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


