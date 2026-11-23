/**
 * Dev loop for the Electron side: rebuild main + preload on change and restart Electron.
 * The UI dev server runs in apps/ui; start both with `pnpm dev` from the repo root.
 */
import { spawn, type ChildProcess } from "node:child_process";

const uiUrl = "http://localhost:5173/";
let electron: ChildProcess | undefined;
let restartTimer: NodeJS.Timeout | undefined;

const startElectron = () => {
  const child = spawn("electron", ["."], {
    stdio: "inherit",
    env: { ...process.env, KLADD_UI_URL: uiUrl },
  });
  child.on("exit", (code, signal) => {
    // Quitting the app (not a restart) ends the dev session.
    if (signal === null && child === electron) {
      pack.kill();
      process.exit(code ?? 0);
    }
  });
  electron = child;
};

const restart = () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    electron?.kill();
    startElectron();
  }, 200);
};

const pack = spawn("vp", ["pack", "--watch"], { stdio: ["ignore", "pipe", "inherit"] });
pack.stdout?.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (/Build complete|Rebuilt in/.test(chunk.toString())) restart();
});
