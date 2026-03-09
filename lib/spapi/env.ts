const ALIASES: Record<string, string[]> = {
  SPAPI_LWA_CLIENT_ID: ["LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_ID", "SP_API_LWA_CLIENT_ID", "SPAPI_CLIENT_ID", "SPAPI_APP_CLIENT_ID"],
  SPAPI_LWA_CLIENT_SECRET: ["LWA_CLIENT_SECRET", "AMAZON_LWA_CLIENT_SECRET", "SP_API_LWA_CLIENT_SECRET", "SPAPI_CLIENT_SECRET", "SPAPI_APP_CLIENT_SECRET"],
  SPAPI_LWA_REFRESH_TOKEN: ["LWA_REFRESH_TOKEN", "AMAZON_LWA_REFRESH_TOKEN", "SP_API_LWA_REFRESH_TOKEN", "SPAPI_REFRESH_TOKEN", "SPAPI_APP_REFRESH_TOKEN"],
  SPAPI_AWS_ACCESS_KEY_ID: ["AWS_ACCESS_KEY_ID", "SP_API_AWS_ACCESS_KEY_ID"],
  SPAPI_AWS_SECRET_ACCESS_KEY: ["AWS_SECRET_ACCESS_KEY", "SP_API_AWS_SECRET_ACCESS_KEY"],
  SPAPI_AWS_SESSION_TOKEN: ["AWS_SESSION_TOKEN", "SP_API_AWS_SESSION_TOKEN"],
  SPAPI_AWS_REGION: ["AWS_REGION", "AWS_DEFAULT_REGION", "SP_API_AWS_REGION", "SPAPI_REGION"],
  SPAPI_HOST: ["AMAZON_SPAPI_HOST"],
  SPAPI_SELLER_ID: ["SELLER_ID", "AMAZON_SELLER_ID", "SP_API_SELLER_ID", "SPAPI_SELLER"],
};

export function envOrEmpty(name: string): string {
  const names = [name, ...(ALIASES[name] ?? [])];
  for (const n of names) {
    const v = String(process.env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function needEnv(name: string): string {
  const v = envOrEmpty(name);
  if (v) return v;

  const alias = ALIASES[name] ?? [];
  const suffix = alias.length ? ` (aliases accepted: ${alias.join(", ")})` : "";
  throw new Error(`Missing env var: ${name}${suffix}`);
}
