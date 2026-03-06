// lib/appsyncGql.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import aws4 from "aws4";
import { DATA_URL, DATA_API_KEY, requireDataApi } from "@/lib/dataEnv";

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

function mustGetRegionFromUrl(url: string): string {
  // AppSync host usually: xxxx.appsync-api.eu-west-2.amazonaws.com
  const host = new URL(url).host;
  const m = host.match(/appsync-api\.([a-z0-9-]+)\.amazonaws\.com/i);
  return m?.[1] ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2";
}

function hasAwsCreds() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

async function fetchJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000); // 20s hard timeout
  try {
    const res = await fetch(url, { ...init, cache: "no-store" as any, signal: controller.signal });
    const json = (await res.json().catch(() => ({}))) as any;
    return { res, json };
  } finally {
    clearTimeout(t);
  }
}

// Primary: IAM (SigV4) if creds exist; fallback: API key if present.
// This is the opposite of what you have now (API key-only), and fixes your “not authorized”.
export async function gql<T>(query: string, variables?: any): Promise<T> {
  requireDataApi();

  const url = DATA_URL; // should already include /graphql
  const region = mustGetRegionFromUrl(url);

  // Prefer IAM if we can
  if (hasAwsCreds()) {
    const body = JSON.stringify({ query, variables });

    const req = aws4.sign(
      {
        method: "POST",
        host: new URL(url).host,
        path: new URL(url).pathname,
        service: "appsync",
        region,
        headers: {
          "content-type": "application/json",
        },
        body,
      },
      {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    );

    const { res, json } = await fetchJson(url, {
      method: "POST",
      headers: req.headers as any,
      body,
    });

    const gqlJson = json as GqlResp<T>;
    if (!res.ok || gqlJson.errors?.length) {
      throw new Error(gqlJson.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
    }
    return gqlJson.data as T;
  }

  // Fallback: API key
  if (DATA_API_KEY) {
    const { res, json } = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
      body: JSON.stringify({ query, variables }),
    });

    const gqlJson = json as GqlResp<T>;
    if (!res.ok || gqlJson.errors?.length) {
      throw new Error(gqlJson.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
    }
    return gqlJson.data as T;
  }

  throw new Error("No AWS creds for IAM signing and no DATA_API_KEY available.");
}