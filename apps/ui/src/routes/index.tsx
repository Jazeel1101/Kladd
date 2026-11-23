import { createFileRoute } from "@tanstack/react-router";
import { RecordingPanel } from "../recording/RecordingPanel";

/** The main window. Each window is a route: the overlay will be /overlay/... */
export const Route = createFileRoute("/")({
  component: RecordingPanel,
});
