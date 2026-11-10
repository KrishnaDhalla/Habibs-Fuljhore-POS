import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/jost/latin-600.css';
import './styles.css';
import App from './App';
import { applyDisplay, watchDisplay } from './lib/display';

// Light or dark colours and text size for this device, before anything is drawn (no flash of the wrong colours)
applyDisplay();
watchDisplay();

// Keeps a copy of the app on the device so it opens without internet.
// When a new version is deployed, an "Update" button appears instead of reloading mid-bill.
window.__posUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__posUpdateReady = true;
    window.dispatchEvent(new Event('pos-update'));
  },
});

// Ask the browser not to clear this app's data when the tablet runs low on space
// (bills waiting to upload live here while the internet is down)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
