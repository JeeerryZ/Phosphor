import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Nested git worktrees (.worktrees/, .claude/worktrees/) live inside this directory
    // tree and would otherwise be swept into the default test glob, running every other
    // worktree's tests in parallel with this one (resource contention, bogus timing failures).
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/.claude/**"],
  },
});
