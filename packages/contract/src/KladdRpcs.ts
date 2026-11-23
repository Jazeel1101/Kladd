import {
  RecordingAlreadyActive,
  RecordingSession,
  ScreenCapturePermissionDenied,
} from "@kladd/domain";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * Every call the UI can make to the main process.
 * Add an Rpc here, then implement it in apps/desktop/src/main/rpc/handlers.ts.
 * Payload, success and error must be schemas from @kladd/domain (or plain Schema), never classes from core.
 */
export class KladdRpcs extends RpcGroup.make(
  Rpc.make("StartRecording", {
    success: RecordingSession,
    error: Schema.Union([RecordingAlreadyActive, ScreenCapturePermissionDenied]),
  }),
  Rpc.make("GetActiveRecording", {
    success: Schema.NullOr(RecordingSession),
  }),
) {}
