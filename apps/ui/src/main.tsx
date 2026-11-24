import { RegistryProvider } from "@effect/atom-react";
import { WindowKind } from "@kladd/domain";
import { Schema } from "effect";
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { ExpandedView } from "./expanded/ExpandedView";
import { LoggingOverlay } from "./logging/LoggingOverlay";
import { RecordingPill } from "./pill/RecordingPill";
import { SnapZones } from "./pill/SnapZones";
import { Settings } from "./settings/Settings";
import "./styles.css";

/** What each window shows. Main opens a window on index.html with its WindowKind as the hash (#pill). */
const windows: Record<WindowKind, ComponentType> = {
  pill: RecordingPill,
  zones: SnapZones,
  logging: LoggingOverlay,
  expanded: ExpandedView,
  settings: Settings,
};

const kind = window.location.hash.slice(1);
const root = document.getElementById("root");
if (root !== null && Schema.is(WindowKind)(kind)) {
  const Window = windows[kind];
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <Window />
      </RegistryProvider>
    </StrictMode>,
  );
}
