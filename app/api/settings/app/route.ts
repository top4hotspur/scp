//app/api/settings/app/route.ts
import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };



const GET_ONE = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euInventoryMarketplaceId
      euMarketplaceIdsJson
      newLinesMarketplaceIdsJson
      inventorySyncEnabled
      inventorySyncActiveOnly
      inventorySyncCadenceMinutesUk
      inventorySyncCadenceMinutesEuAnchor
      inventoryCoverageScanCadenceMinutesEu
      inventoryLastRunByKeyJson
      updatedAtIso
      salesCadenceJson
    }
  }
`;

const CREATE_ONE = /* GraphQL */ `
  mutation CreateAppSettings($input: CreateAppSettingsInput!) {
    createAppSettings(input: $input) { id }
  }
`;

const UPDATE_ONE = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) { id }
  }
`;

function safeNum(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultSettings() {
  const now = new Date().toISOString();
  return {
    id: "global",
    ukMarketplaceId: "A1F83G8C2ARO7P",
    euInventoryMarketplaceId: "A1PA6795UKMFR9",
    euMarketplaceIdsJson: JSON.stringify([
      "A1PA6795UKMFR9", // Germany
      "A13V1IB3VIYZZH", // France
      "APJ6JRA9NG5V4",  // Italy
      "A1RKKUPIHCS9HS", // Spain
      "A1805IZSGTT6HS", // Netherlands
      "AMEN7PMS3EDWL",  // Belgium
      "A2NODRKZP88ZB9", // Sweden
      "A1C3SOZRARQ6R3", // Poland
      "A28R8C7NBKEWEA", // Ireland
    ]),
    // New Lines default marketplaces: UK only (user can add EU marketplaces)
    newLinesMarketplaceIdsJson: JSON.stringify(["A1F83G8C2ARO7P"]),
    inventorySyncEnabled: true,
    inventorySyncActiveOnly: true,
    inventorySyncCadenceMinutesUk: 60,
    inventorySyncCadenceMinutesEuAnchor: 180,
    inventoryCoverageScanCadenceMinutesEu: 10080,

    // EU coverage scan cursor (throttled: one marketplace per run)
    

    inventoryLastRunByKeyJson: "{}",
    updatedAtIso: now,
  };
}

export async function GET() {
  try {
    const data = await gql<{ getAppSettings?: any }>(GET_ONE, { id: "global" });
    if (data?.getAppSettings) return NextResponse.json({ ok: true, settings: data.getAppSettings });

    // auto-create defaults if missing
    const def = defaultSettings();
    await gql(CREATE_ONE, { input: def });
    return NextResponse.json({ ok: true, settings: def });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const now = new Date().toISOString();

    // Merge: read existing (or defaults) so partial PUT doesn't reset fields to false/empty.
let base: any = null;
try {
  const cur = await gql<{ getAppSettings?: any }>(GET_ONE, { id: "global" });
  base = cur?.getAppSettings ?? null;
} catch {
  base = null;
}
if (!base) base = defaultSettings();

// only accept known fields (cheap + safe) but DO NOT overwrite when body omits a field
const input = {
  id: "global",

  ukMarketplaceId:
    body?.ukMarketplaceId !== undefined ? String(body.ukMarketplaceId) : String(base.ukMarketplaceId),

  euInventoryMarketplaceId:
    body?.euInventoryMarketplaceId !== undefined
      ? String(body.euInventoryMarketplaceId)
      : String(base.euInventoryMarketplaceId),

  euMarketplaceIdsJson:
    body?.euMarketplaceIdsJson !== undefined
      ? String(body.euMarketplaceIdsJson)
      : String(base.euMarketplaceIdsJson),
  newLinesMarketplaceIdsJson:
    body?.newLinesMarketplaceIdsJson !== undefined
      ? String(body.newLinesMarketplaceIdsJson)
      : String(base.newLinesMarketplaceIdsJson ?? JSON.stringify([String(base.ukMarketplaceId || "A1F83G8C2ARO7P")])),

  inventorySyncEnabled:
    body?.inventorySyncEnabled !== undefined ? !!body.inventorySyncEnabled : !!base.inventorySyncEnabled,

  inventorySyncActiveOnly:
    body?.inventorySyncActiveOnly !== undefined ? !!body.inventorySyncActiveOnly : !!base.inventorySyncActiveOnly,

  inventorySyncCadenceMinutesUk:
    body?.inventorySyncCadenceMinutesUk !== undefined
      ? safeNum(body.inventorySyncCadenceMinutesUk, 60)
      : safeNum(base.inventorySyncCadenceMinutesUk, 60),

  inventorySyncCadenceMinutesEuAnchor:
    body?.inventorySyncCadenceMinutesEuAnchor !== undefined
      ? safeNum(body.inventorySyncCadenceMinutesEuAnchor, 180)
      : safeNum(base.inventorySyncCadenceMinutesEuAnchor, 180),

  inventoryCoverageScanCadenceMinutesEu:
    body?.inventoryCoverageScanCadenceMinutesEu !== undefined
      ? safeNum(body.inventoryCoverageScanCadenceMinutesEu, 10080)
      : safeNum(base.inventoryCoverageScanCadenceMinutesEu, 10080),

  inventoryLastRunByKeyJson:
    body?.inventoryLastRunByKeyJson !== undefined
      ? String(body.inventoryLastRunByKeyJson)
      : String(base.inventoryLastRunByKeyJson ?? "{}"),

  updatedAtIso: now,
};

    // Upsert
    try {
      await gql(UPDATE_ONE, { input });
    } catch {
      await gql(CREATE_ONE, { input });
    }

    return NextResponse.json({ ok: true, settings: input });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


