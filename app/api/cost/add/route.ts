//api/cost/add/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing amplify_outputs.json data.url/api_key");

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

function yyyyMmDd(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const GET_DAY = /* GraphQL */ `
  query GetDay($id: ID!) {
    getCostRollupDay(id: $id) { id estUsd updatedAtIso }
  }
`;

const GET_KEY = /* GraphQL */ `
  query GetKey($id: ID!) {
    getCostRollupDayByKey(id: $id) { id day key estUsd units updatedAtIso }
  }
`;

const CREATE_DAY = /* GraphQL */ `
  mutation CreateDay($input: CreateCostRollupDayInput!) {
    createCostRollupDay(input: $input) { id estUsd updatedAtIso }
  }
`;

const UPDATE_DAY = /* GraphQL */ `
  mutation UpdateDay($input: UpdateCostRollupDayInput!) {
    updateCostRollupDay(input: $input) { id estUsd updatedAtIso }
  }
`;

const CREATE_KEY = /* GraphQL */ `
  mutation CreateKey($input: CreateCostRollupDayByKeyInput!) {
    createCostRollupDayByKey(input: $input) { id day key estUsd units updatedAtIso }
  }
`;

const UPDATE_KEY = /* GraphQL */ `
  mutation UpdateKey($input: UpdateCostRollupDayByKeyInput!) {
    updateCostRollupDayByKey(input: $input) { id day key estUsd units updatedAtIso }
  }
`;

// note: we don't need a get-by-id for byKey; we try update then create

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const key = String(body?.key ?? "unknown").trim() || "unknown";
  const usd = Number(body?.usd ?? 0);
  const units = Number(body?.units ?? 0);

  const nowIso = new Date().toISOString();
  const day = yyyyMmDd(new Date());

  const addUsd = Number.isFinite(usd) ? usd : 0;
  const addUnits = Number.isFinite(units) ? units : 0;

  // 1) update day total
  const existing = await gql<{ getCostRollupDay: any }>(GET_DAY, { id: day }).catch(() => ({ getCostRollupDay: null }));
  const prev = Number(existing?.getCostRollupDay?.estUsd ?? 0);
  const next = prev + addUsd;

  try {
    await gql(UPDATE_DAY, { input: { id: day, estUsd: next, updatedAtIso: nowIso } });
  } catch {
    await gql(CREATE_DAY, { input: { id: day, estUsd: next, updatedAtIso: nowIso } });
  }

 // 2) update byKey total (accumulate)
const id = `${day}#${key}`;
const existingKey = await gql<{ getCostRollupDayByKey: any }>(GET_KEY, { id }).catch(() => ({ getCostRollupDayByKey: null }));
const prevKeyUsd = Number(existingKey?.getCostRollupDayByKey?.estUsd ?? 0);
const prevKeyUnits = Number(existingKey?.getCostRollupDayByKey?.units ?? 0);

const keyInput = {
  id,
  day,
  key,
  estUsd: prevKeyUsd + addUsd,
  units: prevKeyUnits + addUnits,
  updatedAtIso: nowIso,
};

try {
  await gql(UPDATE_KEY, { input: keyInput });
} catch {
  await gql(CREATE_KEY, { input: keyInput });
}

  return NextResponse.json({ ok: true, day, key, addUsd, addUnits });
}