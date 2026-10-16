/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Tag des Builds (Berlin, „YYYY-MM-DD“) – erscheint als „Stand“ in der Fußzeile */
const BUILD_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_DAY__: JSON.stringify(BUILD_DAY) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
