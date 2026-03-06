// app/api/new-lines/has-inventory/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing outputs.data.url / outputs.data.api_key");

  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": DATA_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data as T;
}

const GET_INVENTORY = /* GraphQL */ `
  query GetInventory($id: ID!) {
    getInventory(id: $id) {
      id
    }
  }
`;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    const trimmed = ids.filter(Boolean).slice(0, 250);

    const existsById: Record<string, boolean> = {};
    for (const id of trimmed) {
      try {
        const data = await gql<{ getInventory?: { id: string } | null }>(GET_INVENTORY, { id });
        existsById[id] = Boolean(data?.getInventory?.id);
      } catch {
        existsById[id] = false;
      }
    }

    return NextResponse.json({ ok: true, existsById });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

