/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev server only: receives demo clips recorded in the browser by
 * src/dev-driver.ts (canvas + app audio) and saves them next to the project.
 */
function demoRecordings(): Plugin {
  return {
    name: 'demo-recordings',
    apply: 'serve',
    configureServer(server) {
      // director scripts and data for scripted takes, read from the video folder
      server.middlewares.use('/__video/', (req, res) => {
        const dir = process.env.VIDEO_DIR ?? resolve(__dirname, '../three-things-video');
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = join(dir, name);
        if (!name || name.includes('..') || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
      server.middlewares.use('/__rec', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = (url.searchParams.get('name') ?? 'clip').replace(/[^\w.-]/g, '_');
        const dir = process.env.REC_DIR ?? resolve(__dirname, '../three-things-video/clips');
        mkdirSync(dir, { recursive: true });
        const out = createWriteStream(join(dir, `${name}.webm`));
        req.pipe(out);
        out.on('finish', () => res.end('saved'));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    iwsdkDev({
      // localhost is a secure context, so plain http is enough for WebXR here
      https: false,
    }),
    demoRecordings(),
  ],
  server: { host: '127.0.0.1', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
