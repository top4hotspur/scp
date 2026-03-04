//lib/dataClient.ts
import { generateClient } from "aws-amplify/data";
import outputs from "@/amplify_outputs.json";

export const dataClient = generateClient({
  config: outputs,
});