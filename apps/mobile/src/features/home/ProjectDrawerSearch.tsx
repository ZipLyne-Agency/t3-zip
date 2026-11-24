import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { useGT, useMessages } from "gt-react-native";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { RowPressable } from "../../components/ui/RowPressable";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";
import { useThreadSearch } from "../../state/queries";
import { ThreadSearchMatchExcerpt } from "../threads/thread-search-match";
import { requestThreadMessageJump } from "../threads/threadMessageJump";
import { useThreadListSearchMatches } from "../threads/useThreadListSearchMatches";
import {
  drawerProjectResults,
  drawerThreadResults,
  type DrawerProjectResult,
} from "./drawer-search";
import { isIndefiniteProjectSnooze } from "./project-drawer";
import { DRAWER_ICON_SIZE, DrawerRow, RowIcon } from "./ProjectDrawerRows";
import { useWakeTime } from "./ProjectDrawerShelves";
import type { ProjectSwitcherRow } from "./project-switcher";
import type { ProjectDrawerData } from "./useProjectDrawer";

// A short query can match hundreds of threads; the heading still counts them all.
const THREAD_RESULT_LIMIT = 50;

/**
 * The drawer's search results: matching projects, hidden and snoozed ones included, then
 * matching threads by title or message. Opening either brings its project back to the list.
 */
export function DrawerSearchResults(props: {
  readonly drawer: ProjectDrawerData;
  readonly query: string;
  readonly onPickProject: (projectKey: string | null) => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const { drawer, query } = props;
  const threads = drawer.shelves.scopeThreads;
  const threadSearch = useThreadSearch(drawer.searchEnvironmentIds, query);
  const matchByKey = useThreadListSearchMatches(threads, threadSearch);

  const projects = drawerProjectResults({
    model: drawer.model,
    rail: drawer.rail,
    query,
    nowMs: drawer.nowMs,
  });
  const threadResults = drawerThreadResults({
    threads,
    query,
    nowMs: drawer.nowMs,
    messageMatchKeys: matchByKey.keys(),
  });
  const shownThreads = threadResults.slice(0, THREAD_RESULT_LIMIT);
  const moreThreads = threadResults.length - shownThreads.length;
  const projectRowByKey = new Map(
    [...drawer.rows.fixed, ...drawer.rows.recent].map((row) => [row.key, row]),
  );

  const pickProject = (row: ProjectSwitcherRow) => {
    if (row.key !== null) drawer.bringBack(row.key);
    props.onPickProject(row.key);
  };
  const openThread = (
    thread: EnvironmentThreadShell,
    match: EnvironmentThreadSearchMatch | undefined,
  ) => {
    const projectKey = drawer.projectKeyOfThread(thread);
    if (projectKey !== null) drawer.bringBack(projectKey);
    if (match?.messageId) {
      requestThreadMessageJump(scopedThreadKey(thread.environmentId, thread.id), match.messageId);
    }
    props.onOpenThread(thread);
  };

  if (projects.length + threadResults.length === 0) {
    // Message matches may still arrive; say nothing until the search has answered.
    if (threadSearch.isPending) return null;
    return (
      <AppText textRole="body" className="px-3 py-4 text-foreground-muted">
        {gt("No projects or threads found")}
      </AppText>
    );
  }

  return (
    <>
      {projects.length > 0 ? (
        <ResultsHeading
          title={gt("Projects", { $context: "project switcher search: matching projects" })}
          count={projects.length}
        />
      ) : null}
      {projects.map((result) => (
        <ProjectResultRow
          key={`project:${result.row.key ?? "all"}`}
          result={result}
          selected={result.row.key === drawer.selectedKey}
          nowMs={drawer.nowMs}
          onPress={() => pickProject(result.row)}
        />
      ))}
      {threadResults.length > 0 ? (
        <ResultsHeading
          title={gt("Threads", { $context: "project switcher search: matching threads" })}
          count={threadResults.length}
        />
      ) : null}
      {shownThreads.map(({ thread, contentOnly }) => {
        const key = threadSearchMatchKey({
          environmentId: thread.environmentId,
          threadId: thread.id,
        });
        const match = contentOnly ? matchByKey.get(key) : undefined;
        const projectKey = drawer.projectKeyOfThread(thread);
        return (
          <ThreadResultRow
            key={`thread:${key}`}
            thread={thread}
            project={projectKey === null ? null : (projectRowByKey.get(projectKey) ?? null)}
            match={match}
            query={threadSearch.query}
            nowMs={drawer.nowMs}
            onPress={() => openThread(thread, match)}
          />
        );
      })}
      {moreThreads > 0 ? (
        <AppText textRole="footnote" className="px-3 py-3 text-foreground-muted">
          {gt(
            "{count, plural, one {# more thread} other {# more threads}}. Keep typing to narrow the list.",
            {
              count: moreThreads,
            },
          )}
        </AppText>
      ) : null}
    </>
  );
}

function ResultsHeading(props: { readonly title: string; readonly count: number }) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${props.title}, ${props.count}`}
      className="flex-row items-center gap-2 px-3 pb-1.5 pt-3.5"
    >
      <AppText
        textRole="label"
        numberOfLines={1}
        className="flex-1 font-t3-medium text-foreground-muted"
      >
        {props.title}
      </AppText>
      <AppText
        textRole="label"
        numberOfLines={1}
        className="text-foreground-muted"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {props.count}
      </AppText>
    </View>
  );
}

function ProjectResultRow(props: {
  readonly result: DrawerProjectResult;
  readonly selected: boolean;
  readonly nowMs: number;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  const wakeTime = useWakeTime();
  const { away } = props.result;
  const detail =
    away === null
      ? undefined
      : away.kind === "hidden"
        ? gt("Hidden", { $context: "project search result: the project is hidden from the list" })
        : isIndefiniteProjectSnooze(away.until)
          ? gt("Snoozed until you wake it")
          : gt("Snoozed until {time}", { time: wakeTime(away.until, props.nowMs) });
  return (
    <DrawerRow
      row={props.result.row}
      selected={props.selected}
      nowMs={props.nowMs}
      detail={detail}
      onPress={props.onPress}
    />
  );
}

/** A thread result, laid out like the drawer's project rows, with its project and last activity. */
function ThreadResultRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly project: ProjectSwitcherRow | null;
  readonly match: EnvironmentThreadSearchMatch | undefined;
  readonly query: string;
  readonly nowMs: number;
  readonly onPress: () => void;
}) {
  const m = useMessages();
  const { thread, project } = props;
  const time = relativeTime(
    resolveThreadActivityTimestamp(thread) ?? thread.createdAt,
    props.nowMs,
    m,
  );
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={
        project ? `${thread.title}, ${project.title}, ${time}` : `${thread.title}, ${time}`
      }
      onPress={props.onPress}
      className="min-h-[52px] flex-row items-center gap-3 rounded-xl px-3 py-1.5"
    >
      {project ? (
        <RowIcon row={project} />
      ) : (
        <View style={{ width: DRAWER_ICON_SIZE, height: DRAWER_ICON_SIZE }} />
      )}
      <View className="min-w-0 flex-1">
        <AppText textRole="body" numberOfLines={1} className="font-t3-medium text-foreground">
          {thread.title}
        </AppText>
        {project ? (
          <AppText textRole="label" numberOfLines={1} className="text-foreground-muted">
            {project.title}
          </AppText>
        ) : null}
        {props.match ? <ThreadSearchMatchExcerpt match={props.match} query={props.query} /> : null}
      </View>
      <AppText
        textRole="label"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        className="w-11 text-right text-foreground-muted"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {time}
      </AppText>
    </RowPressable>
  );
}
