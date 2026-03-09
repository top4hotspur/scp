import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";

export const runtime = "nodejs";

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
      inventoryLastRunByKeyJson
      reportLastSuccessByKeyJson
    }
  }
`;

const GET_CLEAN_SNAPSHOT = /* GraphQL */ `
  query GetCleanListingSnapshot($marketplaceId: String!, $bucket: String!) {
    getCleanListingSnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      createdAtIso
    }
  }
`;

const GET_INV_SNAPSHOT = /* GraphQL */ `
  query GetInventorySnapshot($marketplaceId: String!, $bucket: String!) {
    getInventorySnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      createdAtIso
    }
  }
`;

const GET_SALES_SNAPSHOT = /* GraphQL */ `
  query GetSalesSnapshot($marketplaceId: String!, $bucket: String!) {
    getSalesSnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      createdAtIso
    }
  }
`;

const LIST_REPRICER_STATES = /* GraphQL */ `
  query ListStates($marketplaceId: String!, $limit: Int) {
    listPricePilotStatesByMarketplaceUpdated(marketplaceId: $marketplaceId, limit: $limit) {
      items {
        updatedAtIso
      }
    }
  }
`;

function safeJson<T>(s: unknown, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function uniqNonEmpty(arr: Array<unknown>): string[] {
  return Array.from(new Set(arr.map((x) => String(x ?? "").trim()).filter(Boolean)));
}

const MID_TO_COUNTRY: Record<string, string> = {
  A1F83G8C2ARO7P: "United Kingdom",
  A13V1IB3VIYZZH: "France",
  APJ6JRA9NG5V4: "Italy",
  A1PA6795UKMFR9: "Germany",
  A1RKKUPIHCS9HS: "Spain",
  A1805IZSGTT6HS: "Netherlands",
  AMEN7PMS3EDWL: "Belgium",
  A2NODRKZP88ZB9: "Sweden",
  A1C3SOZRARQ6R3: "Poland",
  A28R8C7NBKEWEA: "Ireland",
};

type HealthRow = {
  system: string;
  marketplaceId: string;
  marketplaceName: string;
  lastAutomationAt: string | null;
  lastSnapshotAt: string | null;
  lastSuccessAt: string | null;
  awsCostPerRunGbp: string;
  note: string;
};

export async function GET() {
  try {
    const s = await gql<{ getAppSettings?: any }>(GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};

    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
    const euMids = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);
    const mids = uniqNonEmpty([ukMid, ...euMids]);

    const runMap = safeJson<Record<string, string>>(settings.inventoryLastRunByKeyJson ?? "{}", {});
    const successMap = safeJson<Record<string, string>>(settings.reportLastSuccessByKeyJson ?? "{}", {});

    const rows: HealthRow[] = [];

    for (const mid of mids) {
      const marketplaceName = MID_TO_COUNTRY[mid] ?? mid;

      const cleanSnap = await gql<{ getCleanListingSnapshot?: { createdAtIso?: string | null } | null }>(GET_CLEAN_SNAPSHOT, {
        marketplaceId: mid,
        bucket: "latest",
      }).catch(() => ({ getCleanListingSnapshot: null }));

      const invSnap = await gql<{ getInventorySnapshot?: { createdAtIso?: string | null } | null }>(GET_INV_SNAPSHOT, {
        marketplaceId: mid,
        bucket: "latest",
      }).catch(() => ({ getInventorySnapshot: null }));

      const salesSnap = await gql<{ getSalesSnapshot?: { createdAtIso?: string | null } | null }>(GET_SALES_SNAPSHOT, {
        marketplaceId: mid,
        bucket: "today",
      }).catch(() => ({ getSalesSnapshot: null }));

      const repricer = await gql<{ listPricePilotStatesByMarketplaceUpdated?: { items?: Array<{ updatedAtIso?: string | null } | null> | null } | null }>(
        LIST_REPRICER_STATES,
        { marketplaceId: mid, limit: 1 }
      ).catch(() => ({ listPricePilotStatesByMarketplaceUpdated: { items: [] } }));

      const repricerUpdated = repricer?.listPricePilotStatesByMarketplaceUpdated?.items?.[0]?.updatedAtIso ?? null;

      rows.push(
        {
          system: "Listings",
          marketplaceId: mid,
          marketplaceName,
          lastAutomationAt: runMap[`LISTINGS:${mid}`] ?? runMap["CLEAN:ALL_LISTINGS:UK"] ?? null,
          lastSnapshotAt: cleanSnap?.getCleanListingSnapshot?.createdAtIso ?? null,
          lastSuccessAt: runMap[`LISTINGS:${mid}`] ?? runMap["CLEAN:ALL_LISTINGS:UK"] ?? null,
          awsCostPerRunGbp: "~£0.01",
          note: "Per marketplace (reportType GET_MERCHANT_LISTINGS_ALL_DATA)",
        },
        {
          system: "Inventory",
          marketplaceId: mid,
          marketplaceName,
          lastAutomationAt: runMap[`INV:${mid}`] ?? null,
          lastSnapshotAt: invSnap?.getInventorySnapshot?.createdAtIso ?? null,
          lastSuccessAt: runMap[`INV:${mid}`] ?? null,
          awsCostPerRunGbp: "~£0.01-0.03",
          note: "Per marketplace inventory summaries + snapshot",
        },
        {
          system: "Sales / Orders",
          marketplaceId: mid,
          marketplaceName,
          lastAutomationAt: runMap[`SALES:${mid}`] ?? null,
          lastSnapshotAt: salesSnap?.getSalesSnapshot?.createdAtIso ?? null,
          lastSuccessAt: successMap[`SALES_ORDERS:${mid}`] ?? null,
          awsCostPerRunGbp: "~£0.02-0.05",
          note: "Per marketplace (reportType GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL)",
        },
        {
          system: "Fee Estimate",
          marketplaceId: mid,
          marketplaceName,
          lastAutomationAt: runMap[`FEE:${mid}`] ?? null,
          lastSnapshotAt: null,
          lastSuccessAt: runMap[`FEE:${mid}`] ?? null,
          awsCostPerRunGbp: "~£0.01-0.04",
          note: "Per marketplace SalesLine feeEstimate writer",
        },
        {
          system: "Repricer",
          marketplaceId: mid,
          marketplaceName,
          lastAutomationAt: runMap[`REPRICER:${mid}`] ?? null,
          lastSnapshotAt: repricerUpdated,
          lastSuccessAt: runMap[`REPRICER:${mid}`] ?? null,
          awsCostPerRunGbp: "~£0.01-0.03",
          note: "Per marketplace decisions from OfferTruth + strategy",
        }
      );
    }

    return NextResponse.json({ ok: true, ukMarketplaceId: ukMid, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
