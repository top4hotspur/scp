import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

// Prefer outputs (what your app actually uses in sandbox)
const DATA_URL = (outputs as any)?.data?.url ?? null;
const DATA_API_KEY = (outputs as any)?.data?.api_key ?? null;

// Also surface process.env in case you’re using lib/dataEnv somewhere
const ENV_DATA_URL = process.env.DATA_URL ?? null;
const ENV_DATA_API_KEY = process.env.DATA_API_KEY ?? null;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      nowIso: new Date().toISOString(),
      amplifyOutputs: {
        hasDataUrl: Boolean(DATA_URL),
        hasApiKey: Boolean(DATA_API_KEY),
        dataUrlPrefix: DATA_URL ? String(DATA_URL).slice(0, 40) : null,
      },
      processEnv: {
        hasDataUrl: Boolean(ENV_DATA_URL),
        hasApiKey: Boolean(ENV_DATA_API_KEY),
        dataUrlPrefix: ENV_DATA_URL ? String(ENV_DATA_URL).slice(0, 40) : null,
      },
    },
    { status: 200 }
  );
}