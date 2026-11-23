import { useAtom, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { DateTime, Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { cn } from "../lib/cn";
import { activeRecordingAtom, startRecordingArgs, startRecordingAtom } from "./atoms";

type StartError = Atom.Failure<typeof startRecordingAtom>;

/** Every error the RPC can return gets its own message. A new error tag makes this a type error. */
const startErrorMessage = (error: StartError): string => {
  switch (error._tag) {
    case "RecordingAlreadyActive":
      return "A recording is already running.";
    case "ScreenCapturePermissionDenied":
      return "Kladd needs screen recording permission (System Settings → Privacy & Security).";
    case "RpcClientError":
      return "Could not reach the app.";
  }
};

export const RecordingPanel = () => {
  const active = useAtomValue(activeRecordingAtom);
  const [startResult, startRecording] = useAtom(startRecordingAtom, { mode: "promiseExit" });
  const startError = AsyncResult.error(startResult);

  return (
    <section className="flex flex-col gap-4 p-6">
      <Button
        className={cn(
          "w-fit rounded-md bg-neutral-900 px-4 py-2 text-white",
          "data-pending:opacity-60",
        )}
        onClick={() => startRecording(startRecordingArgs)}
      >
        Start recording
      </Button>
      {Option.isSome(startError) && (
        <p role="alert" className="text-sm text-red-700">
          {startErrorMessage(startError.value)}
        </p>
      )}
      <p className="text-sm text-neutral-600">
        {AsyncResult.match(active, {
          onInitial: () => "Loading…",
          onFailure: () => "Could not reach the app.",
          onSuccess: ({ value }) =>
            value === null
              ? "Not recording."
              : `Recording since ${DateTime.formatIso(value.startedAt)}`,
        })}
      </p>
    </section>
  );
};
