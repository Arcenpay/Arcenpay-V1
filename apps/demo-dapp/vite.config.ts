import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the SDK straight from source instead of its prebuilt dist.
      // Guarantees the demo runs the LOCAL working-tree code (with Solana
      // support) rather than a published/stale bundle, and lets the runtime
      // API-URL override in internal/core/app-origin.ts actually apply.
      '@arcenpay/react': fileURLToPath(
        new URL('../../packages/sdk-react/src/index.ts', import.meta.url),
      ),
    },
  },
  define: {
    'process.env': '{}',
  },
})
