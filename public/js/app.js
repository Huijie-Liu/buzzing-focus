// =========================================================================
// app.js — Entry point
// =========================================================================
//
// What's Buzzing — a multi-source news aggregator with AI summaries
// and vim-style keyboard navigation.
//
// Architecture
// ┌──────────┐    ┌──────────┐    ┌──────────┐
// │ core.js  │◄───│  api.js  │◄───│  ui.js   │
// │ state    │    │ network  │    │ DOM      │
// │ utils    │    │ streams  │    │ render   │
// │ config   │    │ summary  │    │ keyboard │
// └──────────┘    └──────────┘    └──────────┘
//                                      ▲
//                   ┌──────────────────┘
//                   │  app.js (entry)
//                   └──────────────────┘
// =========================================================================

import { init } from './ui.js';

// Boot the application once the DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Register service worker for offline caching (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Fail silently — the app works without offline support
    });
  });
}
