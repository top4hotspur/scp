//app/api/sales/reports/_spapi.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import aws4 from "aws4";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { envOrEmpty, needEnv } from "@/lib/spapi/env";

const SPAPI_HOST = envOrEmpty("SPAPI_HOST") || "sellingpartnerapi-eu.amazon.com"; // UK/EU
const SPAPI_REGION = envOrEmpty("SPAPI_AWS_REGION") || envOrEmpty("SPAPI_REGION") || "eu-west-1"; // SigV4 region for SP-API


async function getLwaAccessToken(): Promise<string> {
  const clientId = needEnv("SPAPI_LWA_CLIENT_ID");
  const clientSecret = needEnv("SPAPI_LWA_CLIENT_SECRET");
  const refreshToken = needEnv("SPAPI_LWA_REFRESH_TOKEN");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description || json?.error || `LWA HTTP ${res.status}`);
  }
  return String(json.access_token);
}

export async function spapi<T>(path: string, method: "GET" | "POST" | "DELETE", body?: any): Promise<T> {
  const accessKeyId = needEnv("SPAPI_AWS_ACCESS_KEY_ID");
  const secretAccessKey = needEnv("SPAPI_AWS_SECRET_ACCESS_KEY");
  const sessionToken = envOrEmpty("SPAPI_AWS_SESSION_TOKEN") || undefined;

  const lwa = await getLwaAccessToken();

  const url = `https://${SPAPI_HOST}${path}`;
  const payload = body == null ? "" : JSON.stringify(body);

  const headers: Record<string, string> = {
    host: SPAPI_HOST,
    "content-type": "application/json",
    "x-amz-access-token": lwa,
  };

  const req = aws4.sign(
    {
      host: SPAPI_HOST,
      method,
      path,
      region: SPAPI_REGION,
      service: "execute-api",
      headers,
      body: payload,
    },
    { accessKeyId, secretAccessKey, sessionToken }
  );

  const res = await fetch(url, {
    method,
    headers: req.headers as any,
    body: method === "GET" ? undefined : payload,
  });

  const txt = await res.text().catch(() => "");
  const json = txt ? (JSON.parse(txt) as any) : ({} as any);

  if (!res.ok) throw new Error(json?.errors?.[0]?.message || json?.message || `SP-API HTTP ${res.status}`);
  return json as T;
}

export async function downloadAndDecryptReportDocument(doc: {
  url: string;
  compressionAlgorithm?: string | null;
  encryptionDetails?: { key: string; initializationVector: string; standard: string } | null;
}): Promise<Buffer> {
  const url = String(doc?.url ?? "").trim();
  if (!url) throw new Error("Missing reportDocument.url");

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Report download HTTP ${r.status}`);
  const encBytes = Buffer.from(await r.arrayBuffer());

  // decrypt if encryptionDetails exist
  let plain = encBytes;
  const ed = doc?.encryptionDetails;
  if (ed?.key && ed?.initializationVector) {
    const key = Buffer.from(ed.key, "base64");
    const iv = Buffer.from(ed.initializationVector, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    plain = Buffer.concat([decipher.update(encBytes), decipher.final()]);
  }

  const algo = String(doc?.compressionAlgorithm ?? "").toUpperCase();

  // Decompress if declared GZIP
  if (algo === "GZIP") {
    try {
      return zlib.gunzipSync(plain);
    } catch {
      // fall through to sniff
    }
  }

  // Sniff for gzip magic bytes 1F 8B even if not declared
  if (plain.length >= 2 && plain[0] === 0x1f && plain[1] === 0x8b) {
    try {
      return zlib.gunzipSync(plain);
    } catch {
      // ignore; return plain below
    }
  }

  return plain;
}

export function decodeReportText(buf: Buffer): string {
  // UTF-16LE sniff: lots of NULs in early bytes
  const sample = buf.subarray(0, Math.min(buf.length, 200));
  let nul = 0;
  for (const b of sample) if (b === 0x00) nul++;

  if (nul > sample.length * 0.2) {
    // likely UTF-16LE
    return buf.toString("utf16le");
  }

  // UTF-8 (default)
  let s = buf.toString("utf8");

  // strip UTF-8 BOM if present
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  return s;
}

export function parseTsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = String(cols[c] ?? "").trim();
    rows.push(obj);
  }

  return { headers, rows };
}