# Development Notes: Local AI Email Analyser & Deal Rater

This document provides context, findings, performance benchmarks, and recommendations for subsequent agents working on this project.

---

## 🚀 Performance & RAM Benchmarks (Test Run & Ingestion Scan)

We successfully booted the application and ran a test fetch of **5 unread promotional emails** using **Ollama** with the **`llama3.2:latest`** model (2.0 GB). We also monitored a larger batch scan of **80 unread promotional emails** initiated by the user.

### 1. Hardware Environment
* **OS**: macOS (Apple Silicon M-series)
* **Physical Memory**: 16 GB unified RAM

### 2. RAM Usage Metrics
* **Ollama Server Process (`llama-server`)**:
  * **Baseline (Idle, no loaded model)**: 0 MB / Process not active in RAM.
  * **During Inference (Active Ingestion)**: **~3.0 to 3.2 GB RSS** (approx. 19.9% of total system memory).
  * **Unified Memory & Swap Pressure**: Unified memory handles model loading on the Apple Silicon GPU. During continuous, long-running batch ingestion, the system's compressed memory and swap usage can scale up if the model is left loaded indefinitely.
  * **After Inference (Model Unloaded)**: **0 MB** / successfully terminated execution. System free memory returned to **~5.67 GB** after unloading.

### 3. Execution Performance
* **IMAP Mailbox Lock & Search**: ~3–5 seconds to list, establish mailbox lock, and search Gmail categories.
* **Local LLM Inference Speed**: ~3.5 to 4.5 seconds per email for subject classification and deal rating using `llama3.2:latest` on GPU.
* **RAM Cleanup Lifecycle**: Unloading mid-batch (every 20 items) adds load latency to the scan, but leaving the model in memory indefinitely hogs 3 GB of RAM. The optimal approach is to **unload the model from memory immediately at the end of the entire batch scan**.

---

## 🔍 Codebase Review & Implementation Gaps

Upon comparing the codebase against [SPECIFICATION.md](file:///Users/seven/atgravity-playground/Marketing%20email%20analyser/SPECIFICATION.md) and [BUILD_PLAN.md](file:///Users/seven/atgravity-playground/Marketing%20email%20analyser/BUILD_PLAN.md), there is a significant implementation gap.

### 1. The Multi-Category Spec vs. Actual Code
* **The Specification** describes **PromoPulse AI (Multi-Category Edition)**, which is designed to classify emails into 6 distinct categories (*Deals, Newsletters, Receipts, Event Invites, Priority Alerts, and General*) using a **Two-Step AI Pipeline** (Classification Pass + Category-Specific Extraction Pass).
* **The Current Codebase** (`server.js` and `App.jsx`) is actually a **single-category "PromoPulse AI" Deals application** that:
  1. Only runs a single-step LLM extraction for deal parameters (`rating`, `dealSummary`, `discount`, etc.).
  2. Only renders Deals in the UI, calculating average ratings and freebies.
  3. Lacks the tabs, layouts, and detail panels required for the other 5 categories.

### 2. Technical Debt & Improvement Areas
* **Database Layer (`db.js`)**:
  * The application reads and writes the entire JSON array in `data/emails.json` on every single save. As the database grows, this will cause disk I/O lag and increase the risk of file corruption.
  * *Improvement*: Transition to a lightweight SQL database like SQLite (`sqlite3` or `better-sqlite3`).
* **Express Server Organization (`server.js`)**:
  * The server file is monolithic (650+ lines), mixing route handling, configuration management, IMAP client logic, and Ollama integration.
  * *Improvement*: Modularize the backend into distinct directories (`/routes`, `/controllers`, `/services`).
* **React Architecture (`src/App.jsx`)**:
  * The entire frontend app is written in a single file of nearly 1,000 lines.
  * *Improvement*: Componentize the layout (e.g., `Sidebar.jsx`, `Dashboard.jsx`, `Settings.jsx`, `EmailCard.jsx`, `DetailDrawer.jsx`).

---

## 🛠️ Decisions & Changes Made in this Session

1. **Fixed Settings Serialization Bug**:
   * *Problem*: In `server.js`, numeric fields (`imapPort`, `fetchLimit`) were cast via `Number(undefined) -> NaN` when partially updating settings. This caused `config.json` properties to become `null`.
   * *Resolution*: Updated the settings controller in `server.js` to fall back to the existing config if incoming fields are `undefined` or `null`.

2. **Added Dev Server Proxy (`vite.config.js` & `src/App.jsx`)**:
   * Added proxy config to Vite and simplified API calls from hardcoded backend ports to relative route `/api`, solving CORS issues and preventing hardcoding.

3. **In-Memory Caching (`db.js`)**:
   * Introduced memory caching for GET `/api/emails` calls to prevent slow disk reads on every dashboard poll request.

4. **Optimized RAM Management during Ingestion**:
   * *Problem*: Mid-batch model unloading (every 20 items) causes latency, but leaving it loaded forever hogs RAM.
   * *Resolution*: Re-implemented `unloadOllamaModel` and configured it to trigger **only at the end of the entire fetch batch**. This guarantees optimal ingestion speed while immediately freeing up 3 GB of system RAM as soon as the scan finishes.

---

## 📋 Next Steps for Future Development

If the goal is to fully upgrade this project to the **Multi-Category Edition** as per [SPECIFICATION.md](file:///Users/seven/atgravity-playground/Marketing%20email%20analyser/SPECIFICATION.md):
1. **Backend Refactoring**:
   * Refactor `analyzeEmailWithOllama` in `server.js` into two stages:
     * Stage 1: Classify email category (`deal`, `newsletter`, `receipt`, `event`, `alert`, `general`).
     * Stage 2: Prompt-specific extraction based on the resolved category.
2. **Database Schema Expansion**:
   * Update the email record schema to store category-specific metadata blocks (e.g. `dealDetails`, `receiptDetails`, `newsletterDetails`, `eventDetails`, `alertDetails`).
3. **Frontend Dashboard Refactoring**:
   * Add a tab selector at the top of the dashboard for sorting/filtering between different email categories.
   * Render category-specific card components (e.g. green currency tags for receipts, book icons for newsletters).
   * Update the `DetailDrawer` to dynamically display fields matching the active category.
