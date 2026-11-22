import { expect, it } from "vite-plus/test";

import { composerDraftHasUserContent } from "./composer-draft-content";

it("counts text, attachments and context as unsent content, never blank text alone", () => {
  expect(composerDraftHasUserContent(undefined)).toBe(false);
  expect(composerDraftHasUserContent({ text: " \n ", attachments: [] })).toBe(false);
  expect(composerDraftHasUserContent({ text: "Fix it", attachments: [] })).toBe(true);
  expect(
    composerDraftHasUserContent({
      text: "",
      attachments: [
        {
          id: "file",
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 1,
          fileUri: "file:///notes.txt",
        },
      ],
    }),
  ).toBe(true);
  expect(
    composerDraftHasUserContent({
      text: "",
      attachments: [],
      context: { version: 1, records: [] },
    }),
  ).toBe(false);
});
