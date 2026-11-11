import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { validateHosting } from './hosting';
const envDir = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig(({ mode, command }) => {
  if (command === 'build') {
    const variables = loadEnv(mode, envDir, 'VITE_');
    if ((process.env.VITE_API_URL ?? variables.VITE_API_URL ?? '/api/v1') !== '/api/v1')
      throw new Error('Production browser API requests must use /api/v1');
    validateHosting(
      JSON.parse(readFileSync(fileURLToPath(new URL('./vercel.json', import.meta.url)), 'utf8')),
      process.env.VERCEL === '1',
    );
  }
  return {
    plugins: [react()],
    envDir,
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target:
            'http://localhost:' +
            (process.env.PORT ?? loadEnv(mode, envDir, 'PORT').PORT ?? '5000'),
          changeOrigin: false,
        },
      },
    },
    test: { environment: 'jsdom', globals: true },
  };
});
