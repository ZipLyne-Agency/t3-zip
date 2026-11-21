import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
const repoEnvOverrides = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT, ...repoEnvOverrides }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of Object.keys(repoEnvOverrides)) delete repoEnvOverrides[name];
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("builds another team's distribution from the identity override", async () => {
  Object.assign(repoEnvOverrides, {
    T3CODE_MOBILE_APP_NAME: "T3 Zip",
    T3CODE_IOS_BUNDLE_ID: "agency.example.t3zip",
    T3CODE_IOS_TEAM_ID: "TEAM123456",
    T3CODE_CLERK_RELYING_PARTY: "clerk.example.agency",
    T3CODE_MOBILE_HOSTED_APP_HOST: "none",
    T3CODE_IOS_BUILD_NUMBER: "202611210001",
  });
  const config = await loadConfig("production");
  expect(config.name).toBe("T3 Zip");
  expect(config.ios?.bundleIdentifier).toBe("agency.example.t3zip");
  expect(config.ios?.appleTeamId).toBe("TEAM123456");
  expect(config.ios?.buildNumber).toBe("202611210001");
  // The keychain group follows the bundle id, or Clerk sessions would not persist.
  expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
    "$(AppIdentifierPrefix)agency.example.t3zip",
  ]);
  expect(config.ios?.associatedDomains).toEqual([
    "applinks:clerk.example.agency",
    "webcredentials:clerk.example.agency",
  ]);
  expect(config.android?.intentFilters).toEqual([]);
});
