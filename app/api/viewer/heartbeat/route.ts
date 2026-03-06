//app/api/viewer/heartbeat/route.ts
import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };


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


