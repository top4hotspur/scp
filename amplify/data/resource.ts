//amplify/data/resource.ts
import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

const schema = a.schema({
 // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------
InventorySnapshot: a
  .model({
    // Partitioning
    marketplaceId: a.string().required(), // e.g. UK=A1F83G8C2ARO7P, DE=A1PA6795UKMFR9
    bucket: a.string().required(),        // e.g. "latest" (later: "2026-02-25T05:00Z" buckets)

    // Snapshot metadata
    createdAtIso: a.string().required(),  // ISO timestamp of snapshot build
    source: a.string(),                   // e.g. "ingest", "manual", "backstop"
    status: a.string(),                   // "OK" | "EMPTY" | "ERROR"
    message: a.string(),                  // short error / note (keep tiny)

    // Rollups (keep pages fast)
    skus: a.integer(),                    // number of SKUs in snapshot (optional early)
    availableUnits: a.integer(),
    inboundUnits: a.integer(),
    reservedUnits: a.integer(),

    // Optional: store â€œtop listsâ€ as JSON for instant tables (no extra queries)
    // Keep this small. (Later we can move big lists to S3 and reference a key.)
    topLowStockJson: a.string(),           // JSON array of rows (<= ~100 rows)
    })
  .authorization((allow) => [
    // STK-mode dev: allow API key reads/writes for server routes using amplify_outputs.json
    allow.publicApiKey(),
  ])
  .identifier(["marketplaceId", "bucket"]),
  

  InventorySku: a
  .model({
    marketplaceId: a.string().required(),
    sku: a.string().required(),

    shortTitle: a.string(),
    availableUnits: a.integer(),
    inboundUnits: a.integer(),
    reservedUnits: a.integer(),

    supplierName: a.string(),
    prodGroup1: a.string(),
    updatedAtIso: a.string(),
  })
  .authorization((allow) => [allow.publicApiKey()])
  .identifier(["marketplaceId", "sku"]),

  // ---------------------------------------------------------------------------
  // AppSettings (single-record config)
  // ---------------------------------------------------------------------------
  AppSettings: a
    .model({
      id: a.id(), // "global"

      // Marketplaces
      ukMarketplaceId: a.string().required(),         // A1F83G8C2ARO7P
      euInventoryMarketplaceId: a.string().required(), // DE anchor: A1PA6795UKMFR9
      euMarketplaceIdsJson: a.string().required(),    // JSON array of EU mids for coverage scan / UI dropdown
      newLinesMarketplaceIdsJson: a.string(),         // JSON array of marketplaceIds to scan in New Lines (default: UK + selected EU)

      // Inventory sync control (cadence in minutes)
      inventorySyncEnabled: a.boolean().required(),
      inventorySyncActiveOnly: a.boolean().required(),

      inventorySyncCadenceMinutesUk: a.integer().required(),        // e.g. 60
      inventorySyncCadenceMinutesEuAnchor: a.integer().required(),  // e.g. 180 (DE only)
      inventoryCoverageScanCadenceMinutesEu: a.integer().required(), // e.g. 10080 (weekly)

      // State (to keep scheduler cheap)
      inventoryLastRunByKeyJson: a.string(), // JSON map: key -> ISO (e.g. "UK", "EU:DE", "EU:SCAN")
      // ---------------------------------------------------------------------
// Reporting cadence (STK-style scheduler settings)
// ---------------------------------------------------------------------

// Daytime window in Europe/London hours (0-23). Used to choose day vs night cadence.
reportDayStartHour: a.integer(), // e.g. 7
reportDayEndHour: a.integer(),   // e.g. 22

// Per-report cadence settings (JSON). Example:
// {
//   "SALES_ORDERS": { "day": "15m", "night": "1hr" },
//   "SALES_CANCELLATIONS": { "day": "Daily", "night": "Daily" }
// }
reportCadenceByReportJson: a.string(),

// Scheduler state (JSON map: key -> ISO last run). Example:
// { "SALES_ORDERS:UK": "2026-03-01T10:15:00.000Z", ... }
reportLastRunByKeyJson: a.string(),
// Pending report jobs (JSON map key-> { reportId, reportType, createdAtIso, fromIso, toIso })
reportPendingByKeyJson: a.string(),

// Last successful ingestion window end (JSON map key-> ISO). Used for incremental.
reportLastSuccessByKeyJson: a.string(),

      // ---------------------------------------------------------------------
      // Repricer config (stored in AppSettings to keep schema + queries cheap)
      // ---------------------------------------------------------------------
      repricerStrategiesJson: a.string(),      // JSON array of strategies
      repricerAssignmentsJson: a.string(),     // JSON array of assignments (sku / supplier / PG -> strategy)
      repricerSettingsJson: a.string(),        // misc toggles (cooldowns, defaults)

// Default backfill days for first run (e.g. 60)
reportBackfillDays: a.integer(),
      updatedAtIso: a.string().required(),
      salesCadenceJson: a.string(),
      salesLastRunByKeyJson: a.string(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

      // ---------------------------------------------------------------------------
  // SKU Anchor (EU totals: count stock once per SKU)
  // ---------------------------------------------------------------------------
  SkuAnchor: a
    .model({
      id: a.id(), // sku
      sku: a.string().required(),
      inventoryAnchorMarketplaceId: a.string().required(), // e.g. DE, FR, ES...
      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  // ---------------------------------------------------------------------------
  // Viewer session (Active Viewer Gate)
  // ---------------------------------------------------------------------------
  ViewerSession: a
    .model({
      id: a.id(), // "global"
      lastSeenIso: a.string().required(),
      lastPage: a.string(),
      isActive: a.boolean().required(),
      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  // ---------------------------------------------------------------------------
  // Cost rollups (estimated live costs)
  // ---------------------------------------------------------------------------
  CostRollupDay: a
    .model({
      id: a.id(), // yyyy-mm-dd
      estUsd: a.float().required(),
      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  CostRollupDayByKey: a
    .model({
      id: a.id(), // yyyy-mm-dd#key
      day: a.string().required(),
      key: a.string().required(),
      estUsd: a.float().required(),
      units: a.float(),
      updatedAtIso: a.string().required(),
    })
    .secondaryIndexes((idx) => [idx("day").sortKeys(["key"]).name("byDay")])
    .authorization((allow) => [allow.publicApiKey()]),

  // ---------------------------------------------------------------------------
  // Orders â†’ Purchase Orders (Draft-first)
  // ---------------------------------------------------------------------------
  PurchaseOrder: a
    .model({
      id: a.id(), // server-generated

      status: a.string().required(), // "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED"
      supplier: a.string().required(),
      marketplaceId: a.string().required(),
      draftSuffix: a.string().required(),
      createdAtIso: a.string().required(),
      updatedAtIso: a.string().required(),

      totalUnits: a.integer().required(),
      totalValue: a.float().required(),
    })
    .authorization((allow) => [allow.publicApiKey()])
    .secondaryIndexes((idx) => [
      // Query draft quickly by (marketplaceId, supplier, status)
      idx("marketplaceId")
        .sortKeys(["supplier", "status", "updatedAtIso"])
        .name("byMarketplaceSupplierStatus"),
    ]),

  PurchaseOrderLine: a
    .model({
      id: a.id(), // we will set as `${purchaseOrderId}#${sku}`

      purchaseOrderId: a.string().required(),
      sku: a.string().required(),

      qty: a.integer().required(),
      unitCost: a.float().required(),
      lineValue: a.float().required(),
      
      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()])
    .secondaryIndexes((idx) => [
      idx("purchaseOrderId").sortKeys(["sku"]).name("byPurchaseOrder"),
    ]),

  // ---------------------------------------------------------------------------
  // SupplierMap (CSV upload result)
  // ---------------------------------------------------------------------------
  SupplierMap: a
  .model({
    id: a.id(), // skuKey (we will use sku)
    sku: a.string().required(),

    asin: a.string(),
    shortTitle: a.string(),
    fulfillmentChannel: a.string(),

    supplierName: a.string(),
    leadTimeDays: a.integer(),

    prodGroup1: a.string(),
    prodGroup2: a.string(),
    prodGroup3: a.string(),
    prodGroup4: a.string(),
    prodGroup5: a.string(),

    productCost: a.float(),
    prepCost: a.float(),
    shippingCost: a.float(),

    label: a.string(),
    excludeUk: a.boolean(),
    excludeEu: a.boolean(),

    updatedAtIso: a.string().required(),
    })
  .authorization((allow) => [
  // Allow server routes (DATA_API_KEY) to read/list SupplierMap
  allow.publicApiKey().to(["read"]),

  // (Optional but recommended) allow signed-in admin use later
  // allow.authenticated().to(["read", "create", "update", "delete"]),
]),

  // ---------------------------------------------------------------------------
// Clean Listing Health (All Listings report ingest)
// ---------------------------------------------------------------------------

CleanListing: a
  .model({
    id: a.id(), // marketplaceId#sku
    marketplaceId: a.string().required(),
    sku: a.string().required(),
    asin: a.string(),
    title: a.string(),
    price: a.string(),
    quantity: a.string(),
    status: a.string(),
    rawStatus:a.string(),
    inactiveReason: a.string(),
    inactiveReasonCode: a.string(),
    fulfillmentChannel: a.string(),
    updatedAtIso: a.string().required(),
  })
  .authorization((allow) => [allow.publicApiKey()])
  .secondaryIndexes((idx) => [
    idx("marketplaceId").sortKeys(["sku"]).name("byMarketplace"),
    idx("marketplaceId").sortKeys(["status"]).name("byMarketplaceStatus"),
  ]),

CleanListingSnapshot: a
  .model({
    id: a.id(), // marketplaceId#latest
    marketplaceId: a.string().required(),
    bucket: a.string().required(), // "latest"
    createdAtIso: a.string().required(),
    total: a.integer(),
    countsByStatusJson: a.string(), // JSON object
    overlayCountsJson: a.string(), // JSON object (e.g. {"STRANDED":3})
  })
  .authorization((allow) => [allow.publicApiKey()])
  .identifier(["marketplaceId", "bucket"]),

  CleanListingIssue: a
  .model({
    id: a.id(), // marketplaceId#sku#issueType
    marketplaceId: a.string().required(),
    sku: a.string().required(),

    issueType: a.string(),   // e.g. STRANDED
    problemType: a.string(), // from report
    reason: a.string(),      // human readable
    disposition: a.string(),

    availableQuantity: a.integer(),
    reservedQuantity: a.integer(),

    updatedAtIso: a.string().required(),
  })
  .authorization((allow) => [allow.publicApiKey()])
  .secondaryIndexes((idx) => [
    idx("marketplaceId").sortKeys(["sku"]).name("byMarketplaceSku"),
  ]),

  // ---------------------------------------------------------------------------
// Sales (snapshot-first)
// ---------------------------------------------------------------------------
SalesLine: a
  .model({
    // Identity
    marketplaceId: a.string().required(),     // A1F83G8C2ARO7P, A1PA6795UKMFR9, etc
    orderId: a.string().required(),           // AmazonOrderId
    lineId: a.string().required(),            // stable per order line (orderItemId OR sku#asin)
    orderItemId: a.string(),                  // if available
    sku: a.string().required(),
    asin: a.string(),                         // helps create stable lineId + useful for joins

    // Timing
    purchaseAtIso: a.string(),
    shippedAtIso: a.string(),
    reportingAtIso: a.string(),

    // Quantity + money (native currency)
    currency: a.string().required(),
    qty: a.integer().required(),

    itemPrice: a.float(),
    itemTax: a.float(),
    shippingPrice: a.float(),
    shippingTax: a.float(),
    promoDiscount: a.float(),
    promoDiscountTax: a.float(),

    // Denormalized display
    shortTitle: a.string(),
    listingTitle: a.string(),
    imageUrl: a.string(),

    // Profit inputs cached at write-time
    supplierCostExVat: a.float(),
    inboundShipping: a.float(),
    prepCost: a.float(),

    feeEstimateTotal: a.float(),

    // Computed metrics cached
    profitExVat: a.float(),
    marginPct: a.float(),
    roiPct: a.float(),

    orderStatus: a.string(),
    isCanceled: a.boolean(),
  })
    .authorization((allow) => [
    // Server routes ingest and update SalesLine through API key auth
    allow.publicApiKey(),
  ])
  .identifier(["marketplaceId", "orderId", "lineId"])
  .secondaryIndexes((idx) => [
    idx("marketplaceId").sortKeys(["shippedAtIso"]).name("byMarketplaceShippedAt"),
    idx("marketplaceId").sortKeys(["sku"]).name("byMarketplaceSku"),
  ]),
  
  SalesSnapshot: a
    .model({
      marketplaceId: a.string().required(),
      bucket: a.string().required(),            // "today" | "yesterday" | "7d" | "30d" | later: "YYYY-MM-DD"

      createdAtIso: a.string().required(),

      // For the main sales table (already table-ready)
      rowsJson: a.string(),                     // JSON array of SalesRow

      // Top sellers (table-ready)
      topSellersJson: a.string(),               // JSON array of TopSeller rows

      // Summary KPIs (optional)
      totalsJson: a.string(),                   // JSON object: totals/profit/vat etc
    })
    .authorization((allow) => [allow.publicApiKey()])
    .identifier(["marketplaceId", "bucket"]),

      // ---------------------------------------------------------------------------
  // Repricer Engine State + Logs (snapshot-first)
  // ---------------------------------------------------------------------------

  PricePilotState: a
    .model({
      marketplaceId: a.string().required(),
      sku: a.string().required(),

      mode: a.string(),           // MATCH | CLIMB | HOLD | BACKOFF | PAUSED
      reason: a.string(),

      // price band memory
      lastGoodPrice: a.float(),
      lastBadPrice: a.float(),
      currentPrice: a.float(),

      // velocity memory (per day)
      baselineVelPerDay: a.float(), // from 30d or 7d baseline
      last2dVelPerDay: a.float(),
      last7dVelPerDay: a.float(),

      // anti-thrash
      lastChangeIso: a.string(),
      cooldownUntilIso: a.string(),
      changesToday: a.integer(),
      dayKey: a.string(), // yyyy-mm-dd (for change counters)

      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()])
    .identifier(["marketplaceId", "sku"])
    .secondaryIndexes((idx) => [
      idx("marketplaceId").sortKeys(["updatedAtIso"]).name("byMarketplaceUpdated"),
    ]),

  RepricerDecision: a
    .model({
      id: a.id(), // `${marketplaceId}#${sku}#${tsIso}`

      marketplaceId: a.string().required(),
      sku: a.string().required(),
      tsIso: a.string().required(),

      strategyId: a.string(),
      assignmentId: a.string(),

      action: a.string(),   // HOLD | PATCH | CLIMB | BACKOFF | SKIP | DRYRUN
      reason: a.string(),

      ownPrice: a.float(),
      buyBoxPrice: a.float(),
      proposedPrice: a.float(),

      isOnlySeller: a.boolean(),
      ownBuyBox: a.boolean(),

      baselineVelPerDay: a.float(),
      last2dVelPerDay: a.float(),
      last7dVelPerDay: a.float(),

      minPrice: a.float(),
      maxPrice: a.float(),

      note: a.string(),

      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()])
    .secondaryIndexes((idx) => [
      idx("marketplaceId").sortKeys(["tsIso"]).name("byMarketplaceTs"),
      idx("marketplaceId").sortKeys(["sku", "tsIso"]).name("byMarketplaceSkuTs"),
    ]),

  FeeEstimateCache: a
    .model({
      id: a.id(), // `${marketplaceId}#${sku}#${priceKey}`

      marketplaceId: a.string().required(),
      sku: a.string().required(),

      // priceKey e.g. "5.45" (rounded 2dp)
      priceKey: a.string().required(),
      currency: a.string(),

      feeTotal: a.float(),
      feeBreakdownJson: a.string(), // optional (small)

      createdAtIso: a.string().required(),
      expireAt: a.integer().required(), // TTL epoch seconds

      updatedAtIso: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()])
    .secondaryIndexes((idx) => [
      idx("marketplaceId").sortKeys(["sku", "priceKey"]).name("byMarketplaceSkuPrice"),
    ]),

      // ---------------------------------------------------------------------------
  // Listings Truth (STK-style snapshot of offer + buy box)
  // ---------------------------------------------------------------------------
  OfferTruth: a
    .model({
      marketplaceId: a.string().required(),
      sku: a.string().required(),

      asin: a.string(),
      currency: a.string(),

      // â€œTruthâ€ signals
      ownPrice: a.float(),
      buyBoxPrice: a.float(),
      isOnlySeller: a.boolean(),
      ownBuyBox: a.boolean(),

      // Small diagnostics (keep cheap)
      numberOfOffers: a.integer(),
      source: a.string(), // "offersBatch" | "manual" | "event"
      updatedAtIso: a.string().required(),
      rawSummaryJson: a.string(), // optional tiny summary JSON (NOT full payload)
    })
    .authorization((allow) => [allow.publicApiKey()])
    .identifier(["marketplaceId", "sku"])
    .secondaryIndexes((idx) => [
      idx("marketplaceId").sortKeys(["updatedAtIso"]).name("byMarketplaceUpdated"),
    ]),

   FeeEstimate: a
  .model({
    marketplaceId: a.string().required(),
    sku: a.string().required(),
    price: a.float().required(),

    totalFees: a.float(),
    currency: a.string(),

    source: a.string(),
    updatedAtIso: a.string(),
  })
  .authorization((allow) => [allow.publicApiKey()])
  .identifier(["marketplaceId", "sku", "price"]),

  VatSettings: a
    .model({
      id: a.id(),                               // "global" (or sellerId later)

      // VAT
      vatRegisteredJson: a.string(),            // JSON map marketplaceId -> boolean
      vatRateJson: a.string(),                  // JSON map marketplaceId -> number (e.g. 0.20)

      // FX preferences for â€œCombinedâ€
      fxBaseCurrency: a.string(),               // "GBP"
      fxSource: a.string(),                     // "HMRC_MONTHLY" | "ECB_DAILY"
    })
    .authorization((allow) => [allow.publicApiKey()]),

  // ---------------------------------------------------------------------------
  // New Lines - Product Scan Cache (EAN x Marketplace)
  // ---------------------------------------------------------------------------
  ProductScanCache: a
    .model({
      // Composite key
      ean: a.string().required(),
      marketplaceId: a.string().required(),

      // Catalog basics
      asin: a.string(),
      title: a.string(),
      imageUrl: a.string(),

      // Optional price proxy (Catalog summary if present)
      priceAmount: a.float(),
      priceCurrency: a.string(),

      // Rank + category hint
      bsr: a.integer(),
      categoryHint: a.string(),

      // Computed results (optional)
      estMonthlySales: a.integer(),
      estProfit: a.float(),
      estProfitCurrency: a.string(),

      // Trace / TTL
      lastUpdatedAtIso: a.string().required(),
      expireAt: a.integer().required(), // epoch seconds (TTL)
    })
    .authorization((allow) => [allow.publicApiKey()])
    .identifier(["ean", "marketplaceId"]),

  });

  

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});
export type Schema = ClientSchema<typeof schema>;