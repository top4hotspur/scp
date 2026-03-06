// lib/amplifyData.ts
import outputs from "@/amplify_outputs.json";

const DATA_URL = (outputs as any)?.data?.url ?? "";
const DATA_API_KEY = (outputs as any)?.data?.api_key ?? "";

export function getDataConfig() {
  if (!DATA_URL) throw new Error("amplify_outputs.json missing data.url");
  return {
    url: DATA_URL,
    apiKey: DATA_API_KEY, // may be empty if you switch away from API_KEY
  };
}