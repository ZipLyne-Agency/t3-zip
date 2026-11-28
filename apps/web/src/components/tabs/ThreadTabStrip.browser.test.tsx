// Geometry checks need the app stylesheet.
import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily; importing it here keeps its first transform out of the timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useProjectRailStore } from "~/components/rail/railStore";
import {
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

function verticalCenter(element: Element): number {
  const rect = element.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

async function renderTabs() {
  const first = threadWithHistory("tab-strip-first", 1);
  const second = threadWithHistory("tab-strip-second", 1);
  const environment = installFakeEnvironment([first, second]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    sidebarLayout: "project-rail",
  });
  // The strip shows only while the thread column beside the rail is hidden.
  useProjectRailStore.getState().setThreadColumnOpen(false);
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect
    .element(page.getByRole("tab", { name: new RegExp(`^${second.title}`) }), { timeout: 5_000 })
    .toBeVisible();
  return { environment, app, first, second };
}

it("centers every tab part on the strip's middle line", async () => {
  const { environment, app } = await renderTabs();
  using _environment = environment;
  await using _app = app;

  const strip = document.querySelector("[data-thread-tabs]");
  if (!strip) throw new Error("The tab strip did not render");
  const middle = verticalCenter(strip);
  const parts = [
    ...strip.querySelectorAll("[data-tab-key]"),
    ...strip.querySelectorAll("[data-tab-key] svg"),
    ...strip.querySelectorAll("[data-tab-key] [role='tab'] span"),
    ...strip.querySelectorAll("[data-tab-key] > button"),
    page.getByRole("button", { name: /^All Tabs/ }).element(),
  ];
  expect(parts.length).toBeGreaterThan(4);
  for (const part of parts) {
    if (part.getBoundingClientRect().height === 0) continue;
    expect(Math.abs(verticalCenter(part) - middle)).toBeLessThanOrEqual(1);
  }
});

it("renames a thread from its tab's menu", async () => {
  const { environment, app, second } = await renderTabs();
  using _environment = environment;
  await using _app = app;

  const tab = page.getByRole("tab", { name: new RegExp(`^${second.title}`) });
  await userEvent.click(tab, { button: "right" });
  // Without a bound the poll runs to the test deadline and reports a bare timeout.
  await page.getByRole("menuitem", { name: "Rename thread" }).click({ timeout: 5_000 });

  const input = page.getByRole("textbox", { name: "Thread Title" });
  await expect.element(input).toHaveFocus();
  await userEvent.fill(input, "  Renamed From Tab  ");
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({
        type: "thread.metadata.update",
        threadId: second.id,
        title: "Renamed From Tab",
      }),
    ),
  );
  await expect.element(input).not.toBeInTheDocument();
});

it("steps aside while the thread column lists the same threads", async () => {
  const { environment, app, second } = await renderTabs();
  using _environment = environment;
  await using _app = app;

  useProjectRailStore.getState().setThreadColumnOpen(true);
  await expect
    .element(page.getByRole("button", { name: new RegExp(`^${second.title},`) }))
    .toBeVisible();
  expect(document.querySelector("[data-thread-tabs]")).toBeNull();
});

it("sending from a tab in a hidden project brings the project back", async () => {
  const { environment, app, second } = await renderTabs();
  using _environment = environment;
  await using _app = app;

  await userEvent.click(page.getByRole("button", { name: "Actions for render" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Hide Project" }));
  await vi.waitFor(() => expect(useProjectRailStore.getState().hiddenProjects).toHaveLength(1));

  await userEvent.click(page.getByRole("tab", { name: new RegExp(`^${second.title}`) }));
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  await userEvent.keyboard("keep going");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(dispatchedCommands().length).toBeGreaterThan(0));
  await vi.waitFor(() => expect(useProjectRailStore.getState().hiddenProjects).toEqual([]));
});
