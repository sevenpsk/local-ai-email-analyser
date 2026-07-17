# Development Notes: Local AI Email Analyser & Deal Rater

This document provides context, findings, performance benchmarks, and recommendations for subsequent agents working on this project.

---

### 🚀 Performance & RAM Benchmarks (Test Run & Optimizations)

We successfully optimized the ingestion runtime and benchmarked the application with a scan fetch of **unread promotional emails** using **Ollama** with the **`llama3.2:latest`** model (2.0 GB).

### 1. Hardware Environment
* **OS**: macOS (Apple Silicon M-series)
* **Physical Memory**: 16 GB unified RAM

### 2. RAM Usage Metrics
* **Ollama Server Process (`llama-server`)**:
  * **During Inference (Active)**: **~2.43 GB RSS** (approx. 14.5% of total system memory).
  * **After Inference (Model Kept Loaded)**: **~2.43 GB RSS** (remains active in RAM for subsequent scans).
* **Backend Node Server & Vite Server**: negligible (~100 MB combined).

### 3. Execution Performance & Optimizations
* **No Ollama Unloads**: Removed the unloading of the Ollama model between batches and at completion. Keeping the model in memory enables instant response times for subsequent scan operations, removing the ~5-10s cold-start model load latency.
* **Database I/O Cache**: Added an in-memory caching layer (`cachedEmails`) in `db.js`. This eliminates redundant disk-reads during sequential batch updates inside the ingestion loop, significantly reducing file system bottlenecks and transaction lag.
* **Vite API Proxying**: Added a dev server proxy in `vite.config.js` to route all `/api/*` frontend requests directly to port 3001, removing hardcoded hostnames and CORS configurations.

---

## 🔍 Codebase Review & Current Implementation Status

The application is fully operational as a **PromoPulse AI Deals & Ratings application**:
1. It runs a single-step LLM extraction for deal parameters (`rating`, `dealSummary`, `discount`, etc.).
2. Renders promotional offers in the UI, calculating average ratings, hot deals, and freebies.
3. Decouples API ports via Vite proxy.
4. Uses efficient memory-caching database transactions.

---

## 🛠️ Decisions & Changes Made in this Session

1. **Optimized Local LLM Retention**:
   * Removed model unloading mid-batch and end-of-batch to improve sequential run times.
2. **Added Database Read Caching**:
   * Modified `db.js` to cache `emails.json` in memory. `getEmails()` returns the cache if already loaded, avoiding parsing the 800+ KB JSON file from disk on every parsed email save.
3. **Decoupled Backend URL**:
   * Configured `proxy` in `vite.config.js` to forward `/api` requests to port 3001.
   * Updated `API_BASE` in `src/App.jsx` to `/api`.

---

## 📋 Next Steps for Future Development

If you want to continue improving this Promo application:
1. **Frontend Pagination / Virtual Scrolling**:
   * As `data/emails.json` grows beyond 1000+ items, rendering the full email list in React might cause DOM slowdown. Implementing pagination or virtual listing will protect render speeds.
2. **Bulk DB Operations**:
   * Currently, we call `saveEmails([completeEmail])` per parsed email. In large batches, this writes the entire file multiple times. Although disk-reading is cached, writing to the JSON file could be batched at the very end of the scan loop.
