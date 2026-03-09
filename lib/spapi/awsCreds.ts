import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { envOrEmpty, needEnv } from "./env";

export type AwsCreds = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export async function resolveSpApiAwsCreds(): Promise<AwsCreds> {
  const envKey = envOrEmpty("SPAPI_AWS_ACCESS_KEY_ID");
  const envSecret = envOrEmpty("SPAPI_AWS_SECRET_ACCESS_KEY");
  const envToken = envOrEmpty("SPAPI_AWS_SESSION_TOKEN");

  if (envKey && envSecret) {
    return {
      accessKeyId: envKey,
      secretAccessKey: envSecret,
      sessionToken: envToken || undefined,
    };
  }

  try {
    const provider = defaultProvider();
    const c = await provider();
    if (c?.accessKeyId && c?.secretAccessKey) {
      return {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        sessionToken: c.sessionToken,
      };
    }
  } catch {
    // fall through and emit a clearer error below
  }

  // keep explicit message for operators
  needEnv("SPAPI_AWS_ACCESS_KEY_ID");
  needEnv("SPAPI_AWS_SECRET_ACCESS_KEY");
  throw new Error("Missing AWS credentials for SP-API signing");
}
