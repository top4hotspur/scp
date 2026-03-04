// lib/spapi/sigv4.ts
import crypto from "node:crypto";

function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function isoAmzDate(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function dateStampFromAmzDate(amzDate: string) {
  return amzDate.slice(0, 8);
}

function getSigningKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac("AWS4" + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export function signSpApiRequest(args: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: URL;                 // must include pathname + search
  headers?: Record<string, string>;
  body?: string;            // already-stringified
  region?: string;          // default eu-west-1
  service?: string;         // default execute-api
}) {
  const accessKeyId = String(process.env.SPAPI_AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(process.env.SPAPI_AWS_SECRET_ACCESS_KEY ?? "").trim();
  const sessionToken = String(process.env.SPAPI_AWS_SESSION_TOKEN ?? "").trim();

  if (!accessKeyId) throw new Error("Missing env var: SPAPI_AWS_ACCESS_KEY_ID");
  if (!secretAccessKey) throw new Error("Missing env var: SPAPI_AWS_SECRET_ACCESS_KEY");

  const region = String(args.region ?? process.env.SPAPI_AWS_REGION ?? "eu-west-1").trim();
  const service = String(args.service ?? "execute-api").trim();

  const method = args.method;
  const body = args.body ?? "";
  const payloadHash = sha256Hex(body);

  const amzDate = isoAmzDate();
  const dateStamp = dateStampFromAmzDate(amzDate);

  const headers: Record<string, string> = {
    host: args.url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(args.headers ?? {}),
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const canonicalHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${k}:${String(headers[k]).trim()}\n`)
    .join("");

  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");

  const canonicalRequest = [
    method,
    args.url.pathname,
    (() => {
  const pairs: string[] = [];
  // URLSearchParams preserves insertion order; SigV4 needs sorted order
  const sp = new URLSearchParams(args.url.search);
  const keys = Array.from(new Set(Array.from(sp.keys()))).sort();
  for (const k of keys) {
    const vals = sp.getAll(k).sort();
    for (const v of vals) {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.join("&");
})(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${algorithm} ` +
    `Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  headers["authorization"] = authorization;

  return { headers };
}