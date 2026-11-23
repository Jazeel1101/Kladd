import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "../settings/Settings";

export const Route = createFileRoute("/settings")({
  component: Settings,
});
