/**
 * Signs a built T3 Zip with a stable Developer ID, so privacy grants and the device profile
 * that pre-approves them keep matching across rebuilds. Local only and never notarized, so the
 * hardened runtime stays off. Usage: node scripts/t3zip-sign.ts "<T3 Zip.app>" "<identity>"
 */
import { sign } from "@electron/osx-sign";

const [app, identity] = process.argv.slice(2);
if (!app || !identity) {
  throw new Error('usage: t3zip-sign.ts "<T3 Zip.app>" "<signing identity>"');
}

await sign({
  app,
  identity,
  platform: "darwin",
  type: "distribution",
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  batchCodesignCalls: true,
  optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
});
