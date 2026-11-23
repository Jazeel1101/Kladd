import { createFileRoute } from "@tanstack/react-router";
import { ExpandedView } from "../../expanded/ExpandedView";

export const Route = createFileRoute("/overlay/expanded")({
  component: ExpandedView,
});
