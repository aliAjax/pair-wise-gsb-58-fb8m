import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          mantine: [
            "@mantine/core",
            "@mantine/hooks",
            "@mantine/dates",
            "@mantine/notifications",
          ],
          redux: ["@reduxjs/toolkit", "react-redux"],
          flow: ["reactflow"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 18458,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 18458,
    strictPort: true,
  },
});
