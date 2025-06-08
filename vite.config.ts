import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { execa } from 'execa'

const commitHash = await execa('git', ['rev-parse', 'HEAD'])
const now = new Date().toISOString()

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash.stdout),
    __BUILD_DATE__: JSON.stringify(now),
  },
});
