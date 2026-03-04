//app/api/viewer/heartbeat/route.ts
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

const GET_VIEWER = /* GraphQL */ `
  query GetViewer($id: ID!) {
    getViewerSession(id: $id) {
      id
      lastSeenIso
      lastPage
      isActive
      updatedAtIso
    }
  }
`;

const CREATE = /* GraphQL */ `
  mutation CreateViewer($input: CreateViewerSessionInput!) {
    createViewerSession(input: $input) {
      id
      lastSeenIso
      lastPage
      isActive
      updatedAtIso
    }
  }
`;

const UPDATE = /* GraphQL */ `
  mutation UpdateViewer($input: UpdateViewerSessionInput!) {
    updateViewerSession(input: $input) {
      id
      lastSeenIso
      lastPage
      isActive
      updatedAtIso
    }
  }
`;

export async function POST(req: Request) {
  const nowIso = new Date().toISOString();
  const body = await req.json().catch(() => ({}));
  const page = String(body?.page ?? "");

  const id = "global";

  // Try update; if missing, create.
  const input = {
    id,
    lastSeenIso: nowIso,
    lastPage: page,
    isActive: true,
    updatedAtIso: nowIso,
  };

  try {
    await gql(UPDATE, { input });
  } catch {
    await gql(CREATE, { input });
  }

  return NextResponse.json({ ok: true, ts: nowIso });
}

export async function GET() {
  const id = "global";
  const data = await gql<{ getViewerSession: any }>(GET_VIEWER, { id }).catch(() => ({ getViewerSession: null }));
  return NextResponse.json({ ok: true, viewer: data?.getViewerSession ?? null });
}