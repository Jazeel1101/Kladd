# Glossary

Product talk (Linear) is Norwegian; code is English. Use the code name everywhere in code, and add a row before naming a new concept.

| Norwegian (Linear)            | Code name                               | Meaning                                                                                 | In code                                       |
| ----------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| logg                          | `LogEntry`                              | What the student writes about their work; Kladd's end product                           | not yet                                       |
| opptak                        | `RecordingSession`                      | One period where Kladd records what the user does                                       | `packages/domain/src/RecordingSession.ts`     |
| opptaksmodus (manuell / auto) | `RecordingMode` (`"manual"` / `"auto"`) | How a recording starts; only manual is in the MVP                                       | not yet                                       |
| loggemodus                    | `LoggingMode`                           | The state where the user writes a log from what was recorded                            | not yet                                       |
| overlegg                      | `Overlay`                               | A small always-on-top window over other apps; one UI route each                         | `packages/domain/src/Window.ts`               |
| chat composer                 | `Composer`                              | The overlay input where the user talks to the LLM                                       | not yet                                       |
| oppsummering                  | `Summary`                               | LLM-written summary of a recording                                                      | not yet                                       |
| notat                         | `Note`                                  | A saved piece of text or image from a session                                           | not yet                                       |
| BYOK                          | `ProviderKey`                           | The user's own LLM API key; stays on the device                                         | not yet                                       |
| sensitivt innhold             | `SensitiveContent`                      | Content to keep out of recordings (auto mode, post-MVP)                                 | not yet                                       |
| skjermopptak                  | `ScreenCapture`                         | The port for screen permission, screenshots and screen video, implemented per OS        | `packages/core/src/ports/ScreenCapture.ts`    |
| skjermopptakstillatelse       | `ScreenCapturePermission`               | Whether the OS lets Kladd capture the screen (`"granted"` / `"denied"`)                 | `packages/domain/src/ScreenCapture.ts`        |
| skjermbilde                   | `screenshot`                            | A PNG of the main display, without Kladd's own windows                                  | `ScreenCapture.screenshot`                    |
| skjermvideo                   | `recordVideo`                           | A video file of the main display; not the same as a recording session (opptak)          | `ScreenCapture.recordVideo`                   |
| opptaksknapp / pille          | `RecordingPill`                         | Overlay on the left screen edge showing recording state; Kladd's only presence          | `apps/ui/src/pill/RecordingPill.tsx`          |
| loggeoverlegg                 | `LoggingOverlay`                        | Overlay next to where the user writes; opens when a recording stops; holds the composer | `packages/core/src/logging/LoggingOverlay.ts` |
| maksimert visning             | `ExpandedView`                          | Overlay with a recording's summary and images                                           | `apps/ui/src/expanded/ExpandedView.tsx`       |
| app-adapter                   | `AppAdapter`                            | Per-app rules for where the logging overlay sits and what it says the user writes in    | `packages/domain/src/AppAdapter.ts`           |
| skrivested                    | `WritingTarget`                         | The app and document the user writes in, as an adapter reports it                       | `packages/domain/src/WritingTarget.ts`        |
| tilgjengelighetstilgang       | `AccessibilityPermission`               | Whether the OS lets Kladd read other apps' windows and text fields                      | `packages/domain/src/Focus.ts`                |
| fokus                         | `FocusSnapshot`                         | Front app, window frame and title, focused element and caret rects at one moment        | `packages/domain/src/Focus.ts`                |
| anker                         | `Anchor`                                | The rect an overlay is placed next to                                                   | `AppAdapter.anchor`, a `Rect`                 |
