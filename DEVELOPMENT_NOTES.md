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

## 🛠️ Decisions & Changes Made

### 1. Decoupled Two-Phase Email Ingestion & Skimming Architecture
* **The Problem**: Previously, fetching emails and analyzing them with Ollama were coupled synchronously inside a blocking, full-screen modal overlay. For 50–300 promotional emails, this locked the entire application for 5 to 20 minutes (each inference taking ~3.5–4.5s) before the user could read or skim a single email.
* **The Solution**: Decoupled the workflow into two independent phases:
  * **Phase 1: Instant Ingestion (~2-3 seconds)**:
    * IMAP fetch downloads envelope metadata, sender information, raw text, and sanitized HTML.
    * Newly fetched emails are saved immediately into `data/emails.json` with `analysis: null`.
    * Fires an `emails-loaded` Server-Sent Event (SSE) to notify the frontend, immediately populating the dashboard.
  * **Phase 2: Asynchronous Background Analysis Queue**:
    * Created `AnalysisManager` state machine in `server.js` to manage an asynchronous Ollama queue for all unanalyzed emails.
    * Broadcasts real-time SSE events (`status`, `email-analyzed`, `queue-completed`, `queue-stopped`).
    * Exposes endpoints: `GET /api/analysis-status`, `POST /api/analyze-pending`, and `POST /api/analysis/stop`.
    * Unloads the Ollama model from system RAM (`keep_alive: 0`) automatically when the queue finishes or is paused.

### 2. UI & UX Refinements
* **Non-Blocking Floating Progress Widget (`.bg-analysis-widget`)**:
  * Removed the screen-blocking modal overlay entirely.
  * Added a glassmorphic floating progress pill docked at the bottom right that displays a pulsing cyan live indicator, the subject of the email currently being evaluated, an animated progress bar, percentage counter, and pause/dismiss controls.
* **Instant Skimming Support on Dashboard Cards**:
  * Unanalyzed emails render immediately with a `⏳ Queued` badge, raw body snippet preview, and `⚡ Skim Ready` tag.
  * Cards dynamically update in-place with rating badges (e.g. `9/10 EPIC DEAL!`) and discount pills as the background AI finishes each email.
* **Maximized Email Reading Modal & Keyboard Shortcuts**:
  * Clicking any email card immediately displays the full HTML email inside a sandboxed iframe.
  * If the deal is still queued for AI review, the left panel displays a clean pulsing shimmer placeholder (`Deal Evaluation In Progress`) while the email remains 100% interactive.
  * Added keyboard shortcuts for rapid skimming:
    * <kbd>J</kbd> / <kbd>K</kbd>: Flick down / up between emails.
    * <kbd>A</kbd>: Toggle/collapse the AI deal rating panel to maximize horizontal and vertical iframe reading space.
    * <kbd>Esc</kbd>: Close the modal.
* **Header Actions**: Added dynamic `⚡ Rate Pending (N)` and `🗑️ Clear Cache` buttons with native dialog confirmation.

### 3. Database Layer & Consistency (`db.js`)
* **In-Place Patching**: Added `updateEmailAnalysis(key, analysis)` to patch individual email records as background evaluations complete, avoiding rewriting the entire cache array.
* **Cross-Process Consistency**: Adjusted `getEmails()` to read from `data/emails.json` on disk to ensure consistency across separate Node processes, test runners, and server instances.

### 4. Automated Testing & Verification Infrastructure
* **Unit & Logic Tests (`tests/api.test.js`)**: Tests database CRUD operations, in-place updates, and filtering/search logic across mixed pending and analyzed emails.
* **E2E Integration Flow (`tests/e2e_flow.test.js`)**: Tests fast ingestion duration (<500ms), skimming fallback values, hotkey navigation indexing, background updates, and cache clearing.
* **Browser Automation (`tests/browser_e2e.js`)**: Headless Chrome DevTools Protocol automation testing UI rendering, card click, modal opening, J/K hotkeys, floating widget, and clear cache.
* **NPM Script**: Added `"test": "node --test --test-concurrency=1 tests/*.test.js"` to `package.json`.

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
