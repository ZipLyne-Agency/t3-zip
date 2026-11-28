import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { useProjectRailStore } from "./railStore";

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

it("searches projects and threads from the rail, threads as the classic sidebar does", async () => {
  const [first, second] = [threadWithHistory("thread-a", 1), threadWithHistory("thread-b", 1)];
  using _environment = installFakeEnvironment([first, second]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarLayout: "project-rail",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  const search = page.getByRole("combobox", { name: "Search projects and threads" });
  await expect.element(search).toBeVisible();
  await userEvent.fill(search, "thread-b");
  const results = page.getByRole("listbox", { name: "Search results" });
  const threads = results.getByRole("group", { name: /^Threads/ });
  await expect.element(threads.getByText(`Thread ${second.id}`)).toBeVisible();
  // No project is named like the thread, so Threads is the only section.
  await expect.element(results.getByRole("group", { name: /^Projects/ })).not.toBeInTheDocument();
  // The thread view focuses its composer once it loads; return to the search field first.
  await userEvent.click(search);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(router.history.location.pathname).toBe(`/${ENVIRONMENT_ID}/${second.id}`),
  );
  // Opening a result clears the search, so the projects come back.
  await expect.element(results).not.toBeInTheDocument();
  await expect.element(search).toHaveValue("");

  // A project's name lists it under Projects, above the threads.
  await userEvent.click(search);
  await userEvent.fill(search, "render");
  await expect
    .element(results.getByRole("group", { name: /^Projects/ }).getByText("render"))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(search).toHaveValue("");
});

it("lists the open project's threads in the column beside the rail", async () => {
  const [first, second] = [threadWithHistory("thread-a", 1), threadWithHistory("thread-b", 1)];
  using _environment = installFakeEnvironment([first, second]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarLayout: "project-rail",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  const column = page.getByRole("region", { name: "Thread List" });
  await expect.element(column.getByRole("heading", { name: "render" })).toBeVisible();
  const open = column.getByRole("button", { name: new RegExp(`^Thread ${first.id},`) });
  await expect.element(open).toHaveAttribute("aria-current", "page");

  await userEvent.click(column.getByRole("button", { name: new RegExp(`^Thread ${second.id},`) }));
  await vi.waitFor(() =>
    expect(router.history.location.pathname).toBe(`/${ENVIRONMENT_ID}/${second.id}`),
  );

  // A filter belongs to its project: picking another one opens it on All.
  await userEvent.click(column.getByRole("radio", { name: /^Waiting/ }));
  await expect.element(column.getByRole("radio", { name: /^Waiting/ })).toBeChecked();

  // All Projects has no All filter: it opens on Waiting, and these quiet threads stay out.
  await userEvent.click(page.getByRole("button", { name: /All Projects/ }));
  await expect.element(column.getByRole("heading", { name: "All Projects" })).toBeVisible();
  await expect.element(column.getByRole("radio", { name: /^Waiting/ })).toBeChecked();
  await expect.element(column.getByRole("radio", { name: /^All$/ })).not.toBeInTheDocument();
  await expect
    .element(column.getByRole("button", { name: new RegExp(`^Thread ${first.id},`) }))
    .not.toBeInTheDocument();

  // Hiding the column leaves the rail, which can bring it back.
  await userEvent.click(column.getByRole("button", { name: "Hide Thread List" }));
  await expect.element(column).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Show Thread List" }));
  await expect.element(page.getByRole("region", { name: "Thread List" })).toBeVisible();
});

it("sending a message in a hidden project brings it back to the rail", async () => {
  const thread = threadWithHistory("thread-a", 1);
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarLayout: "project-rail",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  const column = page.getByRole("region", { name: "Thread List" });
  await expect.element(column.getByRole("heading", { name: "render" })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Actions for render" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Hide Project" }));
  await vi.waitFor(() => expect(useProjectRailStore.getState().hiddenProjects).toHaveLength(1));

  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  await userEvent.keyboard("keep going");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(useProjectRailStore.getState().hiddenProjects).toEqual([]));
});
