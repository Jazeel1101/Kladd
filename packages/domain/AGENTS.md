# @kladd/domain

The vocabulary of the app: Schema classes, branded IDs, `Schema.TaggedError` errors, and pure functions over them.
Imports: `effect` only.
Copy: `src/RecordingSession.ts`. Pure functions get a plain `*.test.ts` next to them.
Everything here is data and pure logic; anything that needs a service belongs in core.
