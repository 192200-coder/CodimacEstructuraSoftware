import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // El pool por defecto (forks) cierra el canal IPC en Node 24 ("Channel closed").
    pool: "threads",
    exclude: ["dist/**", "node_modules/**"],
  },
})
