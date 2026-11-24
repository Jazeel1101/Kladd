import { assert, describe, it } from "@effect/vitest";
import { DateTime } from "effect";
import { renderOverview, segmentsOf, type OverviewInput } from "./Overview";
import { RecordingSessionId } from "./RecordingSession";
import type { TimelineEvent } from "./SessionFolder";

const session: OverviewInput["session"] = {
  id: RecordingSessionId.make("abc"),
  startedAt: DateTime.makeUnsafe("2026-11-24T13:02:00Z"),
  stoppedAt: DateTime.makeUnsafe("2026-11-24T13:42:00Z"),
  language: "no",
  appVersion: "0.1.0",
  layout: 1,
};

const start: TimelineEvent = {
  type: "start",
  t: 0,
  at: "2026-11-24T13:02:00Z",
  accessibility: true,
  microphone: true,
};
const focus = (t: number, app: string, title: string | null, url?: string): TimelineEvent => ({
  type: "focus",
  t,
  app,
  bundleId: `com.example.${app.toLowerCase()}`,
  title,
  ...(url === undefined ? {} : { url }),
});
const frame = (t: number): TimelineEvent => ({
  type: "frame",
  t,
  file: `frames/${String(t).padStart(6, "0")}.jpg`,
  reason: "change",
  ocr: null,
});

/** A 40-minute session: a robot project in VS Code, a datasheet, a Slack flicker, a break. */
const realistic: OverviewInput = {
  session,
  events: [
    start,
    focus(0, "Code", "main.c — robot"),
    frame(1),
    { type: "activity", t: 10, keys: 84, clicks: 3 },
    frame(240),
    focus(415, "Safari", "HC-SR04 datasheet", "https://cdn.example.com/HCSR04.pdf"),
    frame(416),
    focus(422, "Slack", "#elektro"),
    // Out of order: written after the Slack event that came later.
    frame(420),
    focus(426, "Safari", "HC-SR04 datasheet", "https://cdn.example.com/HCSR04.pdf"),
    focus(700, "Code", "main.c — robot"),
    frame(701),
    { type: "idle", t: 1260 },
    focus(1300, "Finder", "Downloads"),
    { type: "active", t: 1620 },
    focus(1621, "Word", "Logg uke 47.docx"),
    frame(1622),
    { type: "stop", t: 2400, at: "2026-11-24T13:42:00Z" },
  ],
  files: [
    { t: 120, path: "/Users/elev/Code/robot/src/main.c" },
    { t: 180, path: "/Users/elev/Code/robot/src/sensor.h" },
    { t: 760, path: "/Users/elev/Code/robot/src/sensor.c" },
    { t: 1900, path: "/Users/elev/Documents/Logg uke 47.docx" },
  ],
  transcript: [
    { t: 30, end: 36, text: "Nå skal jeg få sensoren til å måle avstand." },
    { t: 430, end: 440, text: "Trig-pinnen må være høy i ti mikrosekunder." },
    { t: 720, end: 726, text: "Ok, det funker | nesten." },
    { t: 1700, end: 1710, text: "Så skriver jeg loggen." },
  ],
};

describe("segmentsOf", () => {
  it("merges flickers, ends idle on active and assigns out-of-order keyframes to their row", () => {
    const rows = segmentsOf(realistic.events).map(({ from, to, focus, idle, frames }) => ({
      from,
      to,
      app: idle ? "idle" : focus?.app,
      frames,
    }));
    assert.deepStrictEqual(rows, [
      { from: 0, to: 415, app: "Code", frames: [1, 240] },
      { from: 415, to: 700, app: "Safari", frames: [416, 420] },
      { from: 700, to: 1260, app: "Code", frames: [701] },
      { from: 1260, to: 1620, app: "idle", frames: [] },
      { from: 1620, to: 2400, app: "Word", frames: [1622] },
    ]);
  });

  it("joins a short first stretch into the row after it", () => {
    const rows = segmentsOf([start, focus(0, "Finder", null), focus(3, "Code", "x")]);
    assert.deepStrictEqual(
      rows.map((r) => [r.from, r.to, r.focus?.app]),
      [[0, 3, "Code"]],
    );
  });

  it("ends at the last event when there is no stop", () => {
    const rows = segmentsOf([start, focus(0, "Code", "x"), frame(90)]);
    assert.deepStrictEqual(
      rows.map((r) => [r.from, r.to]),
      [[0, 90]],
    );
  });
});

describe("renderOverview", () => {
  it("renders a realistic session", () => {
    const text = renderOverview(realistic);
    assert.include(text, "Duration 0:40:00 (t=0–2400). Spoken language: no.");
    assert.notInclude(text, "Missing data");
    assert.include(
      text,
      "| 415–700 | Safari | HC-SR04 datasheet — https://cdn.example.com/HCSR04.pdf | 000416 000420 | Trig-pinnen må være høy i ti mikrosekunder. |",
    );
    assert.include(text, "| 1260–1620 | *idle* |  |  |  |");
    assert.include(text, "det funker \\| nesten.");
    assert.include(text, "/Users/elev/Code/robot/src/\n- main.c (t=120)\n- sensor.c (t=760)");
  });

  it("names missing data: no Accessibility, no microphone, a crash", () => {
    const text = renderOverview({
      session: { ...session, stoppedAt: null, language: null },
      events: [{ ...start, accessibility: false, microphone: false }, focus(0, "Code", null)],
      files: [],
      transcript: [],
    });
    assert.include(text, "Missing data:");
    assert.include(text, "without a `stop` event (a crash)");
    assert.include(text, "No Accessibility permission");
    assert.include(text, "No microphone");
    assert.notInclude(text, "No transcript");
    assert.include(text, "Spoken language: unknown.");
    assert.include(text, "None.");
  });

  it("says when there is a microphone but no transcript", () => {
    const text = renderOverview({ ...realistic, transcript: [] });
    assert.include(text, "No transcript: transcript.jsonl is missing or empty.");
  });

  it("caps speech, keyframes and files per folder, and says where the rest is", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i * 20 + 1));
    const text = renderOverview({
      session,
      events: [start, focus(0, "Code", "x"), ...frames, { type: "stop", t: 300, at: "x" }],
      files: Array.from({ length: 12 }, (_, i) => ({ t: i, path: `/Users/elev/p/f${i}.ts` })),
      transcript: [{ t: 5, end: 200, text: "ord ".repeat(200) }],
    });
    assert.include(text, "000101 +4 |");
    assert.include(text, "…");
    assert.include(text, "- +4 more");
    assert.include(text, "all of them are in `files.jsonl`");
  });
});
