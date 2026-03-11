import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: {
    // Nightly wallet-selector-aptos uses process.env.SNAP_ORIGIN which doesn't exist in browser
    'process.env': JSON.stringify({}),
  },
  resolve: {
    alias: {
      // Force all @aptos-labs packages to use the top-level versions
      // to avoid Nightly's nested ts-sdk@1.35 conflicting with our ts-sdk@1.39
      '@aptos-labs/ts-sdk': path.resolve(__dirname, 'node_modules/@aptos-labs/ts-sdk'),
      '@aptos-labs/aptos-client': path.resolve(__dirname, 'node_modules/@aptos-labs/aptos-client'),
    },
  },
});
