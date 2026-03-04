// amplify/backend.ts
/* amplify/backend.ts */
import { defineBackend } from "@aws-amplify/backend";
import { data } from "./data/resource";
import { schedulerTick } from "./functions/schedulerTick/resource";
import { newLinesScan } from "./functions/new-lines-scan/resource";

import { Stack } from "aws-cdk-lib";
import { RestApi, LambdaIntegration, Cors } from "aws-cdk-lib/aws-apigateway";
import { Duration } from "aws-cdk-lib";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Function as CdkFunction } from "aws-cdk-lib/aws-lambda";

import outputs from "../amplify_outputs.json";

const backend = defineBackend({
  data,
  schedulerTick,
  newLinesScan,
});

// Ensure newLinesScan receives DATA_URL / DATA_API_KEY env vars.
// Cast to CDK Function so addEnvironment is available.
const newLinesFn = backend.newLinesScan.resources.lambda as unknown as CdkFunction;

const DATA_URL = (outputs as any)?.data?.url ?? "";
const DATA_API_KEY = (outputs as any)?.data?.api_key ?? "";

newLinesFn.addEnvironment("DATA_URL", String(DATA_URL));
newLinesFn.addEnvironment("DATA_API_KEY", String(DATA_API_KEY));
// SP-API / LWA secrets (match existing repricer/scheduler lambdas)
//newLinesFn.addEnvironment("SPAPI_LWA_CLIENT_ID", String(process.env.SPAPI_LWA_CLIENT_ID ?? ""));
//newLinesFn.addEnvironment("SPAPI_LWA_CLIENT_SECRET", String(process.env.SPAPI_LWA_CLIENT_SECRET ?? ""));
//newLinesFn.addEnvironment("SPAPI_LWA_REFRESH_TOKEN", String(process.env.SPAPI_LWA_REFRESH_TOKEN ?? ""));
//newLinesFn.addEnvironment("SPAPI_SELLER_ID", String(process.env.SPAPI_SELLER_ID ?? ""));

//newLinesFn.addEnvironment("SPAPI_AWS_ACCESS_KEY_ID", String(process.env.SPAPI_AWS_ACCESS_KEY_ID ?? ""));
//newLinesFn.addEnvironment("SPAPI_AWS_SECRET_ACCESS_KEY", String(process.env.SPAPI_AWS_SECRET_ACCESS_KEY ?? ""));
//newLinesFn.addEnvironment("SPAPI_AWS_SESSION_TOKEN", String(process.env.SPAPI_AWS_SESSION_TOKEN ?? ""));

// EventBridge backstop: every 15 minutes
new Rule(backend.stack, "SchedulerTickRule15m", {
  schedule: Schedule.rate(Duration.minutes(15)),
  targets: [new LambdaFunction(backend.schedulerTick.resources.lambda)],
});

// -----------------------------------------------------------------------------
// New Lines REST API (additive - does not affect schedulerTick)
// -----------------------------------------------------------------------------
const apiStack = backend.createStack("NewLinesApiStack");

const api = new RestApi(apiStack, "NewLinesApi", {
  restApiName: "newLinesApi",
  deploy: true,
  deployOptions: { stageName: "dev" },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: Cors.DEFAULT_HEADERS,
  },
});

const newLines = api.root.addResource("new-lines");
const scan = newLines.addResource("scan");
scan.addMethod("POST", new LambdaIntegration(backend.newLinesScan.resources.lambda));

// Add to outputs (so frontend can call it)
backend.addOutput({
  custom: {
    API: {
      [api.restApiName]: {
        endpoint: api.url,
        region: Stack.of(api).region,
        apiName: api.restApiName,
      },
    },
  },
});