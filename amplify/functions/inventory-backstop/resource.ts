import { defineFunction } from "@aws-amplify/backend";

export const inventoryBackstop = defineFunction({
  name: "inventory-backstop",
  timeoutSeconds: 840, // 14 minutes
});