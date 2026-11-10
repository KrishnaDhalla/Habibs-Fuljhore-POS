import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The 3 face models for face check-in (about 7 MB), served at /models/ straight from the face library
const MODEL_DIR = fileURLToPath(new URL('./node_modules/@vladmandic/face-api/model/', import.meta.url));
const MODEL_FILES = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'].flatMap((m) => [`${m}-weights_manifest.json`, `${m}.bin`]);
const faceModels = () => ({
  name: 'face-models',
  configureServer(server) {
    server.middlewares.use('/models', (req, res, next) => {
      const f = (req.url || '').replace(/^\//, '').split('?')[0];
      if (!MODEL_FILES.includes(f)) return next();
      res.setHeader('Content-Type', f.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.end(readFileSync(MODEL_DIR + f));
    });
  },
  generateBundle() {
    for (const f of MODEL_FILES) this.emitFile({ type: 'asset', fileName: 'models/' + f, source: readFileSync(MODEL_DIR + f) });
  },
});

// "npm run build"       → normal app in dist/ (deploy this). Includes a service worker so the app opens offline.
// "npm run build:demo"  → one self-contained HTML file in dist-demo/ (demo mode, no database, no service worker,
//                         no face check-in: the face models are too big for one file)
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'demo' ? [] : [faceModels()]),
    VitePWA({
      disable: mode === 'demo',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is used
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,webmanifest}'],
        globIgnores: ['models/**', '**/face-api*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/models\//],
        cleanupOutdatedCaches: true,
        // The face models are kept after the first face check-in, not downloaded with every update
        // (the face library too: it is only needed on the tablet that does check-in)
        runtimeCaching: [
          { urlPattern: /\/models\/.+\.(json|bin)$/, handler: 'CacheFirst', options: { cacheName: 'face-models-v1', expiration: { maxEntries: 10 } } },
          { urlPattern: /\/assets\/face-api[^/]*\.js$/, handler: 'CacheFirst', options: { cacheName: 'face-lib-v1', expiration: { maxEntries: 3 } } },
        ],
      },
    }),
    ...(mode === 'demo' ? [viteSingleFile()] : []),
  ],
  resolve: mode === 'demo' ? { alias: { '@vladmandic/face-api': fileURLToPath(new URL('./src/lib/face-stub.js', import.meta.url)) } } : {},
  build: mode === 'demo' ? { outDir: 'dist-demo', assetsInlineLimit: 100000000 } : { outDir: 'dist' },
}));
