import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    cloudflareTest(async () => ({
      wrangler: {
        configPath: './wrangler.jsonc',
      },
    })),
  ],
  test: {
    include: ['tests/worker/ingress/**/*.test.ts'],
    setupFiles: ['./tests/worker/apply-migrations.ts'],
  },
})
