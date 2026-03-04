// amplify/functions/new-lines-scan/resource.ts
import { defineFunction, secret } from "@aws-amplify/backend";

export const newLinesScan = defineFunction({
  name: "new-lines-scan",
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    // SP-API / LWA
    SPAPI_LWA_CLIENT_ID: secret("SPAPI_LWA_CLIENT_ID"),
    SPAPI_LWA_CLIENT_SECRET: secret("SPAPI_LWA_CLIENT_SECRET"),
    SPAPI_LWA_REFRESH_TOKEN: secret("SPAPI_LWA_REFRESH_TOKEN"),
    SPAPI_SELLER_ID: secret("SPAPI_SELLER_ID"),

    // SP-API AWS creds (only if you're using these explicitly in signing)
    SPAPI_AWS_ACCESS_KEY_ID: secret("SPAPI_AWS_ACCESS_KEY_ID"),
    SPAPI_AWS_SECRET_ACCESS_KEY: secret("SPAPI_AWS_SECRET_ACCESS_KEY"),
    SPAPI_AWS_SESSION_TOKEN: secret("SPAPI_AWS_SESSION_TOKEN"),

    // optional but nice to standardize
    SPAPI_AWS_REGION: secret("SPAPI_AWS_REGION"),
    SPAPI_HOST: secret("SPAPI_HOST"),
  },
});