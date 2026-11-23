import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Relative asset URLs: production loads index.html from file:// inside Electron.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
