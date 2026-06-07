# Build Plan: Multi-Category Local AI Email Analyser

This document details the step-by-step implementation blueprint to build the **PromoPulse AI** (Multi-Category Edition) from scratch. It is designed to act as an actionable checklist for developers and junior agentic coding assistants.

---

## 🛠️ Phase 1: Project Setup & Dependencies Configuration

### 1. Initialize Project & Install Dependencies
1. Create a workspace directory and initialize a Node.js module:
   ```bash
   npm init -y
   ```
2. Open `package.json` and set `"type": "module"`.
3. Install production and development dependencies:
   ```bash
   npm install express cors imapflow mailparser react react-dom
   npm install -D vite @vitejs/plugin-react concurrently
   ```

### 2. Configure Scripts (`package.json`)
Modify `package.json` to define concurrent dev commands:
```json
"scripts": {
  "start": "node server.js",
  "server": "node --watch server.js",
  "client": "vite",
  "dev": "concurrently --kill-others \"npm run server\" \"npm run client\"",
  "build": "vite build",
  "preview": "vite preview"
}
```

### 3. Initialize Configuration Files
1. Create a `config.example.json` in the root:
   ```json
   {
     "email": "your-email@gmail.com",
     "appPassword": "your-google-app-password",
     "imapHost": "imap.gmail.com",
     "imapPort": 993,
     "ollamaUrl": "http://localhost:11434",
     "ollamaModel": "gemma4",
     "fetchLimit": 20,
     "searchQuery": "category:promotions OR category:updates OR is:unread"
   }
   ```
2. Duplicate `config.example.json` into `config.json`.
3. Ensure `.gitignore` ignores `config.json`, `node_modules`, `dist`, and `data/`.

---

## 💾 Phase 2: Local Database Controller (`db.js`)

Implement a JSON-based database manager under `db.js` using `fs/promises` for local persistence.

### 1. Path Resolutions & Directory Safety
- Resolve `__dirname` for ES module compatibility.
- Define `DATA_DIR` as `/data` and `DB_FILE` as `/data/emails.json`.
- Implement `ensureDbExists()`:
  - Try to create `DATA_DIR` using `fs.mkdir(DATA_DIR, { recursive: true })`.
  - Try to access `DB_FILE`. If it does not exist, initialize it with a stringified empty array `[]`.

### 2. Database Utilities
1. **`getEmails()`**:
   - Call `ensureDbExists()`.
   - Read `DB_FILE`, parse as JSON array, and return. Return `[]` on error.
2. **`saveEmails(emailsToSave)`**:
   - Read current emails with `getEmails()`.
   - Instantiate a `Map` of key-value pairs where key is `email.messageId || email.uid.toString()`.
   - Loop over `emailsToSave`, setting each inside the map to overwrite existing keys (prevents duplicates).
   - Convert map values back to an array.
   - Sort the array in descending order: `updatedList.sort((a, b) => new Date(b.date) - new Date(a.date))`.
   - Write stringified contents back to `DB_FILE` with formatting indentation (`JSON.stringify(updatedList, null, 2)`).
3. **`clearAllEmails()`**:
   - Overwrite `DB_FILE` with `[]` and return `[]`.

---

## 🔌 Phase 3: Express Backend & Two-Step AI Pipeline (`server.js`)

Implement `server.js` with IMAP integrations, two-step Ollama classification/extraction models, and Server-Sent Events (SSE).

### 1. Initialize Express App & Settings
- Configure JSON parser middleware and CORS.
- Set up `loadConfig()` and `saveConfig(config)` helpers to read/write `config.json` incorporating the `searchQuery` string.
- **`GET /api/settings`**: Returns configuration elements without returning the plain credentials string (return `hasPassword: !!config.appPassword` instead).
- **`POST /api/settings`**: Saves configurations. Ensure existing password is kept if `appPassword` is omitted or empty.
- **`GET /api/emails`** and **`POST /api/emails/clear`**: Proxy DB utilities.
- **`POST /api/test-imap`** and **`POST /api/test-ollama`**: Connection testing routes.

### 2. Implement Two-Step Local AI Pipeline
Create a unified `analyzeEmailWithOllama(config, subject, sender, plaintext)` runner.
*   **Plaintext Truncation**: Slice content to the first 3000 characters to keep local inference speed high.
*   **Step 1: Classification Pass**:
    - Build classification System Prompt (Deals, Newsletters, Receipts, Event Invites, Priority Alerts, General).
    - Query `${config.ollamaUrl}/api/chat` using `POST`.
    - Parameters: `options.temperature = 0.1`, `format = "json"`, `stream = false`.
    - Retrieve parsed classification: `{ category, priority, actionRequired, summary }`.
*   **Step 2: Specialized Extraction Pass**:
    - Read the classified `category`. If the category is `"general"`, bypass Step 2 to save time.
    - Set up a switch statement or map to select the matching System Prompt and JSON schema for `deal`, `receipt`, `newsletter`, `event`, or `alert` (as specified in `SPECIFICATION.md`).
    - Query `${config.ollamaUrl}/api/chat` using `POST` with the category prompt.
    - Retrieve parsed extraction JSON.
*   **Integration & Fallbacks**:
    - Wrap the calls in a robust `try/catch`. If an Ollama request times out (using a 20-second AbortController) or crashes, populate an error fallback block (e.g. category: `general`, priority: `medium`, reason: `Ollama timeout`) and continue processing.
    - Return the fully integrated analysis payload matching the database schema.

### 3. Implement mark-all-read (`POST /api/emails/mark-all-read`)
- Retrieve cached emails from the database. Extract non-empty UIDs into a list.
- Connect to IMAP. Run folder auto-discovery (All Mail or Inbox).
- Acquire mailbox lock.
- Run `await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })`.
- Release lock, logout, and return count marked.

### 4. Implement SSE Email Scan & Fetch Endpoint (`GET /api/fetch`)
- Write headers for Server-Sent Events (`Content-Type: text/event-stream`).
- Create a `sendEvent(event, data)` writing helper.
- **Scanning Sequence**:
  1. Connect to IMAP.
  2. Locate folder: if `useInbox` is false, check for Gmail special use `\\All` or folders containing "all mail" or "ทั้งหมด". Fall back to `[Gmail]/All Mail`.
  3. Acquire mailbox lock.
  4. Search: Execute Gmail-native search utilizing the user's custom `searchQuery` string via `client.search({ gmraw: config.searchQuery }, { uid: true })`.
  5. Compare found UIDs against database cached UIDs. Discard duplicates.
  6. Fetch up to `fetchLimit` new email packages: envelope and raw source.
  7. Parse with `simpleParser(message.source)` to build structured metadata.
  8. Release mailbox lock and logout.
  9. **AI Pipeline Loop**:
     - Loop through parsed emails. For each, send `progress` SSE events.
     - Call `analyzeEmailWithOllama`.
     - Save each email to the database immediately with `db.saveEmails()` inside the loop to prevent loss on crash.
     - **RAM Optimization**: Check if `(i + 1) % 20 === 0`. If true, call `unloadOllamaModel` to release model weights from system RAM.
  10. **Final RAM Cleanup**: Call `unloadOllamaModel` at the end of the entire loop sequence to ensure no idle memory consumption.
  11. Emit `complete` event with count. Close connection.

---

## 🎨 Phase 4: CSS Design System (`src/index.css`)

Create a gorgeous dark-theme design using vanilla CSS.

### 1. Variables & Global Styles
- Define Outfits (display headings) and Inter (sans-serif text).
- Construct deep HSL palettes: `--bg-deep: hsl(222, 47%, 6%)`, glassmorphic surfaces (`--bg-surface: hsla(223, 30%, 10%, 0.65)`), and primary buttons (`--primary: hsl(250, 85%, 65%)`).
- Write color-coded rating indicators for scores and badges:
  - Deals (Gold/Red): `linear-gradient(135deg, #f59e0b, #ef4444)` with a gold pulsing shadow animation.
  - Receipts (Green): `linear-gradient(135deg, #10b981, #047857)`
  - Newsletters (Blue/Cyan): `linear-gradient(135deg, #4fa3e3, #1d6fa5)`
  - Events (Purple): `linear-gradient(135deg, #8b5cf6, #5b21b6)`
  - Alerts (Deep Red/Amber): `linear-gradient(135deg, #ef4444, #b91c1c)`

### 2. Category Tab Bar Styling
- Style tab containers at the top of the dashboard.
- Nav items should render horizontal indicator lines, HSL text changes, and background transformations when `.active` is toggled.

### 3. Dynamic Card Renders
- Style dynamic layouts for specific cards:
  - Receipt card: Large green badge rendering price values, grid displays for purchase counts.
  - Alert card: Red outline accents, triangle exclamation signs, severity badge alignments.
  - Event card: Blue calendar layouts, date/time overlays, virtual map-pin indicators.

---

## ⚛️ Phase 5: React Dashboard Integration (`src/App.jsx`)

Write the frontend interactive UI.

### 1. Initialize State Hooks
- Tab selector state: `activeTab` (defaults to `'all'`, toggles: `'deal'`, `'newsletter'`, `'receipt'`, `'event'`, `'alert'`).
- Cached email lists, selected drawer item, and loading states.
- Settings parameters state, including the custom `searchQuery` input field.
- Live scan event state: active state, status messages, processed counts, and email subjects.
- Clipboard copy button indicators.

### 2. Implement Settings Form
- Build a Settings tab containing inputs for Gmail credentials, Ollama endpoint details, fetch limits, and the crucial **Custom Search Query** input field with help labels.
- Wire save buttons to POST to `/api/settings` and connection buttons to POST to test routes.

### 3. Compute Live Metrics
Calculate dashboard metrics dynamically on each render loop:
- Scanned: `emails.length`
- Avg Rating: `(sum of ratings / length)` formatted to 1 decimal place.
- Hot Deals: list length with rating >= 8.
- Priority Alerts: list length with alert severity matching `'critical'`.

### 4. Implement Segment Filtering & Dynamic Rendering
- Combine search box inputs, min score range value, and tab selections.
- Filter emails array dynamically:
  ```javascript
  const filtered = emails.filter(e => {
    const matchesTab = activeTab === 'all' || e.analysis.category === activeTab;
    const matchesSearch = e.subject.toLowerCase().includes(term) ||
                          e.fromName.toLowerCase().includes(term) ||
                          e.analysis.summary.toLowerCase().includes(term);
    return matchesTab && matchesSearch;
  });
  ```
- Map items inside the grid.
- **Dynamic Card Logic**: Use a switch/case block inside `.map()` to render specific card styles:
  - If `deal`: rating badge, discount tag.
  - If `receipt`: green price pill (`+$45.00`), merchant title.
  - If `newsletter`: book icon, topic tags, estimated read time.
  - If `event`: calendar icon, date, location.
  - If `alert`: warning icon, severity tag, issue summary.

### 5. Build Adapting Drawer (Slide Over)
- Render the drawer panel when `selectedEmail` is not null.
- Wire backdrop click handler to close the drawer (`setSelectedEmail(null)`).
- **Dynamic AI Review Panel**: Inside the left column, switch layout based on `selectedEmail.analysis.category`:
  - `deal`: Circular rating score, promo code clipboard copying triggers, expiration date, explanation.
  - `receipt`: Merchant title, invoice details, itemization table (listing all items and individual costs), total expense.
  - `newsletter`: Reading time, key takeaways bullet points, category topic tags.
  - `event`: Event title, date/time, location, direct RSVP links.
  - `alert`: Severity meter, problem description, immediate action recommended, and deadline alerts.
- **Original Iframe**: The right-hand panel remains a fully sandboxed `iframe` rendering the original HTML.

---

## 🧪 Phase 6: Verification & Handshake

Verify all aspects of the application.

1. **Verify Development Mode**:
   - Run `npm run dev`. Ensure Node server starts on `http://localhost:3001` and Vite on `http://localhost:5173`.
2. **Verify Configuration**:
   - Save custom search query and check if `config.json` changes.
3. **Verify Two-Step Fetch Stream**:
   - Run **Scan & Rate Emails**. Watch overlay update live as emails fetch, classify (Step 1), and extract (Step 2).
   - Check if structured records write to `data/emails.json` successfully.
4. **Verify Filters**:
   - Toggling tabs filters the dashboard grid and loads category-specific layout card styles without lagging.
5. **Verify Drawer & Sandbox**:
   - Click a card. Confirm original email renders beautifully in the sandboxed iframe without script execution. Copy promo codes.
