import { RegistryProvider } from "@effect/atom-react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { windowRoutes, type WindowKind } from "@kladd/domain";
import { routeTree, type FileRoutesByFullPath } from "./routeTree.gen";
import "./styles.css";

// Hash history: production loads index.html from file://, where path URLs don't resolve.
// A window opens its route with loadFile(index.html, { hash: "/overlay/..." }).
const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Main loads each window's route from domain `windowRoutes`. A type error here names a route with no
// file in src/routes: add the route file (copy src/routes/overlay/pill.tsx).
void (windowRoutes satisfies Record<WindowKind, keyof FileRoutesByFullPath>);

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <RouterProvider router={router} />
      </RegistryProvider>
    </StrictMode>,
  );
}
