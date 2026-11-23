import { createFileRoute } from "@tanstack/react-router";
import { RecordingPill } from "../../pill/RecordingPill";

export const Route = createFileRoute("/overlay/pill")({
  component: RecordingPill,
});
