/* amplify/functions/schedulerTick/resource.ts */
import { defineFunction, secret } from "@aws-amplify/backend";

export const schedulerTick = defineFunction({
  name: "schedulerTick",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,

  // IMPORTANT:
  // Set SCP_APP_BASE_URL to your deployed app origin (e.g. https://main.<id>.amplifyapp.com)
  // For sandbox you can set it to your branch hosting URL, not localhost.
  environment: {
    SCP_APP_BASE_URL: secret("SCP_APP_BASE_URL"),
    // Optional safety token; if you set this, the route requires matching token
    SCHEDULER_TOKEN: secret("SCHEDULER_TOKEN"),
  },
});