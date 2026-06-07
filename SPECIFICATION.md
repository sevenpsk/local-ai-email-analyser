# Technical Specification: Multi-Category Local AI Email Analyser

This document outlines the expanded technical specification for **PromoPulse AI** (Multi-Category Edition). The application classifies incoming emails into custom categories (Deals, Newsletters, Receipts, Event Invites, Priority Alerts, and General), extracts tailored structural metadata using a **Two-Step AI Pipeline** running on local LLMs via Ollama, and displays them inside an interactive, dynamically adapting React dashboard.

---

## 📂 Project Structure & Tech Stack

```
Marketing email analyser/
├── package.json               # Dependencies, concurrently script runners
├── server.js                  # Express backend, IMAP integration, Two-step Ollama pipeline
├── db.js                      # De-duplicated local JSON database layer
├── index.html                 # Frontend index with outfit & inter Google Fonts
├── config.json                # User settings (ignored in git)
├── config.example.json        # User settings template
├── data/
│   └── emails.json            # Local JSON database stores multi-category email records
└── src/
    ├── main.jsx               # React entry point
    ├── App.jsx                # Tabbed multi-category dashboard, settings & details drawer
    └── index.css              # Custom HSL variables, animations & glassmorphic dark layouts
```

---

## ⚙️ Configuration & Data Schema

### 1. System Configuration: `config.json`
Configuration includes a custom search query and adjustable parameters for fetching.

```json
{
  "email": "user@gmail.com",
  "appPassword": "xxxx xxxx xxxx xxxx",
  "imapHost": "imap.gmail.com",
  "imapPort": 993,
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "gemma4",
  "fetchLimit": 50,
  "searchQuery": "category:promotions OR category:updates OR is:unread"
}
```

### 2. Multi-Category Local Database Schema: `data/emails.json`
Stores the email text and the structured outcomes of the two-step AI parsing pipeline.

```typescript
interface EmailRecord {
  uid: number;
  messageId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  date: string; // ISO date format
  html: string; // Sandboxed original HTML markup
  text: string; // Plaintext content (used for AI scans)
  analysis: {
    category: 'deal' | 'newsletter' | 'receipt' | 'event' | 'alert' | 'general';
    priority: 'high' | 'medium' | 'low';
    actionRequired: boolean;
    summary: string; // 1-sentence general overview
    analyzedAt: string;
    error?: boolean; // True if LLM fails

    // Exactly one of the following details blocks is populated based on category
    dealDetails?: {
      rating: number; // 0-10 score
      discount: string; // extracted discount (e.g. "20% off")
      couponCodes: string[];
      expirationDate: string;
      explanation: string;
    };
    receiptDetails?: {
      merchant: string;
      totalAmount: string;
      currency: string;
      taxAmount: string;
      invoiceNumber: string;
      items: Array<{ item: string; price: string }>;
    };
    newsletterDetails?: {
      keyTakeaways: string[];
      topics: string[];
      estimatedReadingTime: string;
    };
    eventDetails?: {
      eventName: string;
      eventDateTime: string;
      location: string;
      rsvpLink: string;
      rsvpDeadline: string;
    };
    alertDetails?: {
      issue: string;
      severity: 'critical' | 'warning' | 'info';
      suggestedAction: string;
      deadline: string;
    };
  };
}
```

---

## 🔌 Backend APIs (`server.js`)

All endpoints are hosted on `http://localhost:3001` and prefixed with `/api`.

### Endpoints Inventory
1. **`GET /api/settings`**: Retrieves settings. Conceals credentials behind a `hasPassword: true/false` flag.
2. **`POST /api/settings`**: Updates and saves `config.json` preferences.
3. **`POST /api/test-imap`**: Opens temporary connection with credentials to verify authentication.
4. **`POST /api/test-ollama`**: Pings local Ollama server tags API `/api/tags` and checks if model is available.
5. **`GET /api/emails`**: Fetches all cached categorized email records from `data/emails.json`.
6. **`POST /api/emails/clear`**: Wipes out cached email logs (`[]`).
7. **`POST /api/emails/mark-all-read`**: Reads active cached email UIDs and marks them seen in Gmail.
8. **`GET /api/fetch` (Streaming Scan)**:
   - Sets Server-Sent Events headers (`text/event-stream`).
   - Connects to the folder auto-discovered via standard lists, or defaults to Gmail All Mail.
   - Searches emails utilizing the user's custom Gmail filter query string (`config.searchQuery`) via the `gmraw` parameter: `client.search({ gmraw: config.searchQuery }, { uid: true })`.
   - Filters out already-cached UIDs to prevent repetitive processing.
   - Fetches and parses up to `fetchLimit` uncached emails.
   - **Runs the Two-Step AI Pipeline** on each new email (detailed below) and immediately saves the result to the local database inside the loop to prevent loss on crash.
   - Emits progress events and closes stream.

---

## 🧠 Two-Step Local AI Pipeline

The pipeline uses two sequential local AI calls to ensure maximum classification and extraction accuracy.

```
                  ┌──────────────────────┐
                  │    Incoming Email    │
                  └──────────┬───────────┘
                             │
            ┌────────────────▼────────────────┐
            │   Pass 1: Classification Prompt  │
            └────────────────┬────────────────┘
                             │
            ┌────────────────▼────────────────┐
            │  JSON: { category, priority }   │
            └────────┬───────┬────────┬───────┘
                     │       │        │
             Deals  ─┘       │        └─ Receipts
          ┌──────────┐ ┌─────┴────┐ ┌──────────┐
          │  Pass 2  │ │  Pass 2  │ │  Pass 2  │
          │Specialized││Specialized││Specialized│
          │  Deals   │ │Newsletter│ │ Receipts │
          └──────────┘ └──────────┘ └──────────┘
```

### Step 1: Classification Pass
- **Purpose**: Fast category routing and metadata mapping.
- **Request URL**: `${config.ollamaUrl}/api/chat`
- **Options**: `temperature: 0.1`, `format: "json"`, `stream: false`
- **System Prompt**:
  ```markdown
  You are an expert email routing assistant. Classify the incoming email into one of these categories:
  - "deal": promotional offers, sales, coupons, and discount deals.
  - "newsletter": long-form articles, summaries, blog posts, and text-heavy newsletters.
  - "receipt": purchase receipts, invoices, order confirmations, and shipping notifications.
  - "event": meeting invites, webinars, RSVPs, calendars, and booking confirmations.
  - "alert": server notifications, security alerts, system errors, and urgent warnings.
  - "general": personal messages, chats, and items not matching other categories.

  Determine the priority of the email ('high', 'medium', or 'low') based on urgency.
  Determine if the email requires active follow-up action (actionRequired: true or false).

  You must return a JSON object with this schema:
  {
    "category": "deal" | "newsletter" | "receipt" | "event" | "alert" | "general",
    "priority": "high" | "medium" | "low",
    "actionRequired": boolean,
    "summary": "1-sentence summary of the email subject/objective"
  }
  ```

---

### Step 2: Specialized Extraction Pass
Based on the category returned in Step 1, the backend executes a second, custom extraction prompt with a specialized schema.

#### A. Category: `deal`
- **System Prompt**:
  ```markdown
  Analyze this promotional email and extract deal parameters.
  Rate the offer from 0 to 10 (0-2: no deal/newsletter, 3-5: standard 10% off, 6-8: substantial 20-50% off, 9-10: epic freebies or 70%+ off).

  Output JSON schema:
  {
    "rating": number (0-10),
    "discount": "extracted discount string, e.g. '20% off' or '$15 off'",
    "couponCodes": ["array of promo codes"],
    "expirationDate": "expiration date or 'Unknown'",
    "explanation": "1-2 sentences justifying the rating"
  }
  ```

#### B. Category: `receipt`
- **System Prompt**:
  ```markdown
  Extract transaction records from this email receipt.
  Output JSON schema:
  {
    "merchant": "name of seller/vendor",
    "totalAmount": "total price paid with currency, e.g. '$45.00'",
    "currency": "3-letter currency code, e.g. 'USD'",
    "taxAmount": "total tax paid or '$0.00'",
    "invoiceNumber": "invoice/receipt ID or 'Unknown'",
    "items": [
      { "item": "name of product or service purchased", "price": "cost, e.g. '$15.00'" }
    ]
  }
  ```

#### C. Category: `newsletter`
- **System Prompt**:
  ```markdown
  Analyze this newsletter article and extract key knowledge blocks.
  Output JSON schema:
  {
    "keyTakeaways": ["3-5 bullet points of primary lessons or information"],
    "topics": ["list of main subjects/tags discussed"],
    "estimatedReadingTime": "estimated reading time, e.g. '5 min read'"
  }
  ```

#### D. Category: `event`
- **System Prompt**:
  ```markdown
  Extract calendar/booking parameters from this invitation. Parse relative dates based on sent timestamp if needed.
  Output JSON schema:
  {
    "eventName": "title of event, meeting, or reservation",
    "eventDateTime": "date and time, e.g. 'Oct 24, 2026, 3:00 PM'",
    "location": "location address, virtual link, or 'Unknown'",
    "rsvpLink": "direct RSVP/meeting link or 'None'",
    "rsvpDeadline": "deadline date/time or 'None'"
  }
  ```

#### E. Category: `alert`
- **System Prompt**:
  ```markdown
  Analyze this alert notification and extract diagnostic details.
  Output JSON schema:
  {
    "issue": "clear description of the alert problem or subject",
    "severity": "critical" | "warning" | "info",
    "suggestedAction": "immediate step recommended to resolve this alert",
    "deadline": "response deadline or 'Immediate'"
  }
  ```

*Note: For the `general` category, the second pass is skipped, using the initial step 1 classification summary to speed up operations.*

### 🐏 Memory Optimization & RAM Release
To prevent Ollama from indefinitely hogging system RAM during long email ingestion batches, a model-release utility is integrated:
- **Unload Frequency**: Every 20 emails processed, the server sends a request to Ollama to unload the model.
- **Unload Payload**: Sends a `POST` request to `/api/chat` with:
  ```json
  {
    "model": "model_name",
    "messages": [],
    "keep_alive": 0
  }
  ```
- **Execution Lifecycle**: Triggered mid-batch (every 20 items) and automatically at the completion of the scan batch.
- **Reload behavior**: The next email processing request to Ollama will implicitly trigger it to reload the model from disk, ensuring RAM is clean and free of cumulative leakage.

---

## 🎨 Frontend Architecture & Tabbed UI Layout

The React interface adapts dynamically based on the active category tab.

### 1. Category Navigation Tabs
Located at the top of the dashboard. Toggling tabs filters the list and changes UI rendering variables.
*   **All**: Chronological mixed feed showing all items.
*   **🏷️ Deals**: Displays cards displaying rating badges and discount tags.
*   **📰 Newsletters**: Displays cards highlighting bullet counts and reading times.
*   **🧾 Receipts**: Displays cards highlighting merchant names and total price values.
*   **📅 Events**: Displays cards highlighting calendar event times and locations.
*   **🚨 Alerts**: Displays cards highlighting severity warnings and deadlines.

### 2. Dynamic Card Renders
Each email card changes its layout elements based on its category:
- **Deals**: Large circular rating score badge with dynamic colors (gold pulsing shadow for 9-10 score) + discount tag.
- **Receipts**: Large green currency tag showing `totalAmount` (e.g. `+$120.00`) + item purchase count tag.
- **Newsletters**: Large book icon badge + topic tag list + estimated reading time indicator.
- **Events**: Large blue calendar date badge + event time + virtual location indicator.
- **Alerts**: Large warning triangle badge with severity color filters (Red for Critical, Yellow for Warning) + priority urgency rating.

### 3. Adapting Details Drawer (Slide Over)
Clicking a card opens the Detail Drawer. The left-hand **AI Review** panel changes its structure based on the category:
- **Deals**: Circular rating score, promo code list with clipboards copying triggers, expiration date, explanation.
- **Receipts**: Merchant title, invoice details, itemization table (listing all items and individual costs), tax, total expense.
- **Newsletters**: Reading time, a list of structured key takeaways, and category topic tags.
- **Events**: Calendar event card displaying event title, date/time, location, and a button to click direct RSVP links.
- **Alerts**: Severity meter, problem description, immediate action recommended, and deadline alerts.
- **Original Iframe**: The right-hand panel remains a fully sandboxed `iframe` rendering the original HTML.

---

## 🔒 Security Practices

1.  **Gmail Credential Safety**: The settings page uses `type="password"` styling indicators and backend placeholders to prevent credentials leak. Custom `searchQuery` keeps scans targeted.
2.  **Strict Sandbox Rendering**: Sandboxed `iframe` uses `sandbox="allow-popups"` only, disabling scripting, document manipulation, and tracking scripts from executing.
3.  **Local Offline Privacy**: Both classification and specialized extraction passes run strictly locally inside local Ollama parameters.
