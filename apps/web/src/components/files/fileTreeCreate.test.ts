import { describe, expect, it } from "vite-plus/test";

import {
  followEntryChange,
  forgetCreatedFile,
  isCreatedFile,
  markCreatedFile,
  UNTITLED_FILE_NAME,
  newEntryStemLength,
  newEntryFolder,
  newEntryNameProblem,
  newEntryPath,
  suggestPastedFileName,
} from "./fileTreeCreate";

describe("newEntryFolder", () => {
  it("targets a folder row, a file row's folder, or the project root", () => {
    expect(newEntryFolder(null)).toBe("");
    expect(newEntryFolder("")).toBe("");
    expect(newEntryFolder("docs/")).toBe("docs");
    expect(newEntryFolder("docs/notes/")).toBe("docs/notes");
    expect(newEntryFolder("docs/notes/plan.md")).toBe("docs/notes");
    expect(newEntryFolder("README.md")).toBe("");
  });

  it("joins a name onto the folder", () => {
    expect(newEntryPath("", "a.md")).toBe("a.md");
    expect(newEntryPath("docs/notes", "a.md")).toBe("docs/notes/a.md");
  });
});

describe("newEntryNameProblem", () => {
  it("accepts ordinary names", () => {
    for (const name of [UNTITLED_FILE_NAME, "notes", ".env.local", "a b.md", "v1.2.md", "~draft"]) {
      expect(newEntryNameProblem(name)).toBeNull();
    }
  });

  it("rejects empty names, separators, dot segments and absolute paths", () => {
    expect(newEntryNameProblem("")).toBe("empty");
    expect(newEntryNameProblem("a/b.md")).toBe("separator");
    expect(newEntryNameProblem("a\\b.md")).toBe("separator");
    expect(newEntryNameProblem("/etc/passwd")).toBe("separator");
    expect(newEntryNameProblem("..")).toBe("dots");
    expect(newEntryNameProblem(".")).toBe("dots");
    expect(newEntryNameProblem("a..md")).toBe("dots");
    expect(newEntryNameProblem("C:\\notes.md")).toBe("absolute");
    expect(newEntryNameProblem("~/notes.md")).toBe("separator");
  });
});

describe("newEntryStemLength", () => {
  it("selects a file name up to its extension, and a whole folder name", () => {
    expect(newEntryStemLength("Untitled.md", "file")).toBe("Untitled".length);
    expect(newEntryStemLength("archive.tar.gz", "file")).toBe("archive.tar".length);
    expect(newEntryStemLength(".env", "file")).toBe(".env".length);
    expect(newEntryStemLength("Makefile", "file")).toBe("Makefile".length);
    expect(newEntryStemLength("v1.2", "folder")).toBe("v1.2".length);
  });
});

describe("suggestPastedFileName", () => {
  const lateEvening = new Date(2026, 10, 22, 23, 30);

  it("dates the name from the local day and slugs the first non-empty line", () => {
    expect(suggestPastedFileName("\n\n  # Weekly Sync: Q4 Roadmap!\nrest", lateEvening)).toBe(
      "2026-11-22-weekly-sync-q4-roadmap.md",
    );
    expect(suggestPastedFileName("Standup", new Date(2026, 0, 5, 0, 5))).toBe(
      "2026-01-05-standup.md",
    );
  });

  it("keeps at most six words in plain ASCII", () => {
    expect(
      suggestPastedFileName("Café meeting with Zoë about the new déjà vu plan", lateEvening),
    ).toBe("2026-11-22-cafe-meeting-with-zoe-about-the.md");
  });

  it("falls back to notes when the first line has no letters or digits", () => {
    expect(suggestPastedFileName("—— ✨ ——\nbody", lateEvening)).toBe("2026-11-22-notes.md");
    expect(suggestPastedFileName("日本語のメモ", lateEvening)).toBe("2026-11-22-notes.md");
  });
});

describe("followEntryChange", () => {
  it("moves an open file with its own rename or its folder's", () => {
    const renamed = { type: "renamed", from: "notes", to: "meetings" } as const;
    expect(followEntryChange("notes", renamed)).toBe("meetings");
    expect(followEntryChange("notes/plan.md", renamed)).toBe("meetings/plan.md");
    expect(followEntryChange("notes-old/plan.md", renamed)).toBeUndefined();
    expect(followEntryChange(null, renamed)).toBeUndefined();
  });

  it("closes an open file that was deleted, alone or with its folder", () => {
    const deleted = { type: "deleted", path: "drafts" } as const;
    expect(followEntryChange("drafts", deleted)).toBeNull();
    expect(followEntryChange("drafts/a/b.md", deleted)).toBeNull();
    expect(followEntryChange("drafts.md", deleted)).toBeUndefined();
  });
});

describe("created files", () => {
  it("marks a new file until its first open forgets it", () => {
    expect(isCreatedFile("env", "/repo", "notes.md")).toBe(false);
    markCreatedFile("env", "/repo", "notes.md");
    expect(isCreatedFile("env", "/repo", "notes.md")).toBe(true);
    expect(isCreatedFile("env", "/other", "notes.md")).toBe(false);
    forgetCreatedFile("env", "/repo", "notes.md");
    expect(isCreatedFile("env", "/repo", "notes.md")).toBe(false);
  });
});
