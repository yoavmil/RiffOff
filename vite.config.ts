import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pages/index.html is the app (the Stage Amp design). Any pages/<folder>/index.html is an
// extra page served at /<folder>/, e.g. to try an alternative design side by side.
const pagesDir = resolve(__dirname, 'pages');
const input: Record<string, string> = { main: resolve(pagesDir, 'index.html') };
for (const name of readdirSync(pagesDir)) {
  const html = resolve(pagesDir, name, 'index.html');
  if (existsSync(html)) input[name] = html;
}

export default defineConfig({
  root: pagesDir,
  publicDir: resolve(__dirname, 'public'),
  // GitHub Pages serves the app from /RiffOff/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  // Pages live in pages/ but load their code from src/: "/src/..." maps to the real folder.
  resolve: { alias: [{ find: /^\/src\//, replacement: `${resolve(__dirname, 'src')}/` }] },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input },
  },
  server: {
    host: true, // expose on the LAN so a phone on the same Wi-Fi can connect
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
