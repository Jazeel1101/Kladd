import { Schema } from "effect";

/** Whether the OS lets Kladd capture the screen (GLOSSARY: "skjermopptakstillatelse"). */
export const ScreenCapturePermission = Schema.Literals(["granted", "denied"]);
export type ScreenCapturePermission = typeof ScreenCapturePermission.Type;

export class ScreenCapturePermissionDenied extends Schema.TaggedError<
  ScreenCapturePermissionDenied,
  { readonly brand: unique symbol }
>()("ScreenCapturePermissionDenied", {}) {}

/** The capture itself broke: no display, a file that could not be written, a missing helper. */
export class ScreenCaptureFailed extends Schema.TaggedError<
  ScreenCaptureFailed,
  { readonly brand: unique symbol }
>()("ScreenCaptureFailed", { reason: Schema.String }) {}
