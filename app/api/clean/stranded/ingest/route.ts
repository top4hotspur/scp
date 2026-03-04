//app/api/clean/stranded/ingest/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";
import fs from "fs";
import path from "path";
export const runtime = "nodejs";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

async function gql(query: string, variables?: any): Promise<any> {
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e: any) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data ?? null;
}

const CREATE_ISSUE = /* GraphQL */ `
  mutation CreateCleanListingIssue($input: CreateCleanListingIssueInput!) {
    createCleanListingIssue(input: $input) { id }
  }
`;

const UPDATE_ISSUE = /* GraphQL */ `
  mutation UpdateCleanListingIssue($input: UpdateCleanListingIssueInput!) {
    updateCleanListingIssue(input: $input) { id }
  }
`;

const LIST_ISSUES_BY_MARKETPLACE = /* GraphQL */ `
  query ListCleanListingIssues($limit: Int, $nextToken: String, $filter: ModelCleanListingIssueFilterInput) {
    listCleanListingIssues(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { id marketplaceId sku issueType updatedAtIso }
      nextToken
    }
  }
`;

async function upsertIssue(input: any) {
  try {
    await gql(CREATE_ISSUE, { input });
  } catch {
    await gql(UPDATE_ISSUE, { input });
  }
}

function nowIso() {
  return new Date().toISOString();
}

// Very small parser that supports comma CSV OR tab TSV
function parseDelimited(text: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { header: [], rows: [] };

  const first = lines[0].replace(/^\uFEFF/, "");
  const delim = first.includes("\t") ? "\t" : ",";

  const header = first.split(delim).map((s) => s.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim);
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = String(parts[c] ?? "").trim();
    rows.push(obj);
  }

  return { header, rows };
}

// Normalise possible header names from different exports
function pick(r: Record<string, string>, ...keys: string[]) {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function pickInt(r: Record<string, string>, ...keys: string[]) {
  const v = pick(r, ...keys);
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // File name can be overridden: /api/clean/stranded/ingest?mid=...&file=Stranded.csv
    const file = String(url.searchParams.get("file") ?? "Stranded.csv").trim();

    // We expect this file in your repo root (C:\dev\scp\Stranded.csv)
    const filePath = path.resolve(process.cwd(), file);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Missing file on server: ${filePath}. Put ${file} in the repo root (C:\\dev\\scp\\${file}).`,
        },
        { status: 500 }
      );
    }

    const text = fs.readFileSync(filePath, "utf8");
    const parsed = parseDelimited(text);

    if (!parsed.header.length) {
      return NextResponse.json({ ok: false, error: "Could not parse stranded file (no header)" }, { status: 500 });
    }

    let imported = 0;
    let skipped = 0;

    for (const r of parsed.rows) {
      const sku = pick(r, "sku", "seller-sku", "seller_sku").replace(/\u00A0/g, " ").trim();
      if (!sku) {
        skipped++;
        continue;
      }

            await upsertIssue({
        id: `${mid}#${sku}#STRANDED`,
        marketplaceId: mid,
        sku,
        issueType: "STRANDED",
        problemType: pick(r, "problem-type", "problem_type", "problem type"),
        reason: pick(r, "reason", "detailed-reason", "detailed_reason"),
        disposition: pick(r, "disposition"),
        availableQuantity: pickInt(r, "available-quantity", "available_quantity", "available quantity"),
        reservedQuantity: pickInt(r, "reserved-quantity", "reserved_quantity", "reserved quantity"),
        updatedAtIso: nowIso(),
      });

      imported++;
    }

    // Readback proof (so we know GraphQL sees what we wrote)
let proofCount = 0;
try {
  const data = await gql(LIST_ISSUES_BY_MARKETPLACE, {
    limit: 50,
    filter: { marketplaceId: { eq: mid } },
  });
  const items = Array.isArray(data?.listCleanListingIssues?.items) ? data.listCleanListingIssues.items : [];
  proofCount = items.length;
} catch {
  proofCount = -1;
}

return NextResponse.json({
  ok: true,
  mid,
  file: filePath,
  header: parsed.header,
  issuesImported: imported,
  skippedRows: skipped,
  proofListCount: proofCount,
});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}