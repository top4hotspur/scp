// lib/dataEnv.ts
import outputs from "@/amplify_outputs.json";

const fromEnv = (k: string) => (process.env[k] ?? "").toString().trim();

function normalizeGraphqlUrl(u: string): string {
  const url = (u ?? "").toString().trim();
  if (!url) return "";
  // AppSync GraphQL endpoint must end with /graphql
  if (url.endsWith("/graphql")) return url;
  return url.replace(/\/+$/, "") + "/graphql";
}

const outputsUrlRaw =
  (outputs as any)?.data?.url ? String((outputs as any).data.url) : "";
const outputsKey =
  (outputs as any)?.data?.api_key ? String((outputs as any).data.api_key) : "";

// Prefer explicit env vars, else fall back to amplify_outputs.json
const envUrlRaw = fromEnv("DATA_URL");
export const DATA_URL = normalizeGraphqlUrl(envUrlRaw || outputsUrlRaw);
export const DATA_API_KEY = fromEnv("DATA_API_KEY") || outputsKey;

export function requireDataApi() {
  if (!DATA_URL || !DATA_API_KEY) {
    throw new Error(
      "Missing DATA_URL / DATA_API_KEY (set env vars or ensure amplify_outputs.json contains data.url + data.api_key)"
    );
  }
  return { DATA_URL, DATA_API_KEY };
}

export const NEWLINES_API_ENDPOINT =
  process.env.NEWLINES_API_ENDPOINT ||
  process.env.NEXT_PUBLIC_NEWLINES_API_ENDPOINT ||
  "";

export function requireNewLinesEndpoint() {
  if (!NEWLINES_API_ENDPOINT) {
    throw new Error("Missing NEWLINES_API_ENDPOINT");
  }
  return NEWLINES_API_ENDPOINT;
}