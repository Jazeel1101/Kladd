import { createFileRoute } from "@tanstack/react-router";
import { LoggingOverlay } from "../../logging/LoggingOverlay";

export const Route = createFileRoute("/overlay/logging")({
  component: LoggingOverlay,
});
