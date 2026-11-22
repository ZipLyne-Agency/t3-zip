// The project snooze logic lives in client-runtime so the phone app shares it.
export {
  activeSnoozedProjectKeys,
  wokenSnoozedProjectKeys,
} from "@t3tools/client-runtime/state/project-rail";
export type { SnoozedProjects } from "@t3tools/client-runtime/state/project-rail";
