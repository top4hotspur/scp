import { defineFunction } from "@aws-amplify/backend";

export const inventoryBackstop = defineFunction({
  name: "inventory-backstop",
  // Every 60 minutes (you can tighten later)
  schedule: "every 60 minutes",
  timeoutSeconds: 840, // 14 minutes
});