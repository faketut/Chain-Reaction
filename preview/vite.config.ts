import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    fs: {
      // Allow reaching into ../src for client/shared files.
      allow: [resolve(here, '..')],
    },
  },
  resolve: {
    alias: {
      // Source path aliases.
      '@shared': resolve(here, '../src/shared'),
      '@client': resolve(here, '../src/client'),
      // Package aliases — the src/ files live outside this preview package, so
      // bare-package imports there can't be resolved by Node's walk-up. Pin
      // them to the preview's installed copies.
      'matter-js': resolve(here, 'node_modules/matter-js'),
      phaser: resolve(here, 'node_modules/phaser'),
    },
  },
  optimizeDeps: {
    include: ['matter-js', 'phaser'],
  },
});
