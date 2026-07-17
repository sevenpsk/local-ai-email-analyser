# 📧 Local AI Email Analyser & Deal Rater

A self-hosted, private web application designed to fetch, scan, and rate promotional emails and newsletters from your Gmail account using a local AI model (via Ollama). Keep your inbox, data, and rating models entirely private on your own hardware!

---

## 💡 Project Origin & Philosophy

This project was born out of a very common daily frustration: **getting completely overwhelmed by too many marketing and promotional emails.** 

### 🚀 The Journey: From Python to "Vibe Coding"
- **The Initial Attempt**: I originally started building a solution using a simple Python script and exporting the analyzed email data to a `.csv` file. 
- **The Vibe Coding Breakthrough**: Seeking a more interactive and usable dashboard, I decided to try "vibe coding" using **Gemini on Antigravity**. I was incredibly impressed by how effectively Gemini could build a fully realized, responsive, and gorgeous React dashboard integrated with an Express.js backend. It far exceeded my initial scope and expectations!

### ⚙️ Maintainability & Simplicity
- **The Stack**: The application currently runs on a modern **React (Vite) + Node.js (Express)** stack.
- **Acknowledging My Expertise**: To be transparent, **I have no formal expertise in this specific Web/React stack.** 
- **The Goal**: Because of this, my primary directive is to **keep the project simple, clean, and easy to maintain**. I want to avoid overcomplicating the architecture so it remains accessible to run, modify, and understand.

### 🤝 Feedback, Suggestions & Security
I am very open to recommendations and ideas from the open-source community! 
- **🔒 Security & Privacy**: Since this app integrates with personal Gmail accounts, security is highly critical. If you have any recommendations for security hardening, please open an issue or pull request.
- **💡 Recommendations**: If there are ways to clean up or optimize the code while keeping it extremely simple and readable, I'd love to hear them!

---

## ✨ Features

- **🔐 Local & Secure**: No third-party AI APIs used. All email scanning, analysis, and rated databases are processed and stored locally on your machine.
- **🏷️ Gmail Intelligent Category Scanning**: Utilizes native Gmail-specific IMAP query filters (e.g., scanning the `Promotions` category or searching unread emails).
- **🤖 Ollama Powered Rating**: Automatically rates promotional deals on a scale of `0` to `10` and extracts key information:
  - **Deal Summary** (1-sentence overview)
  - **Discount/Coupon Value** (e.g., "30% off" or "$20 coupon")
  - **Promo Codes**
  - **Expiration Dates**
- **📊 Interactive Dashboard**: A premium, modern React frontend to view, filter, clear, and test settings.

---

## 🛠️ System Architecture

- **Frontend**: React + Vite (serving a beautifully designed interactive UI).
- **Backend**: Express.js server (connecting to Gmail via `imapflow`, parsing emails with `mailparser`, and sending prompt jobs to Ollama).
- **AI Model Orchestrator**: Ollama running locally (recommended model: `llama3.2` or `llama3.2:latest`).
- **Database**: Local JSON file cache (`data/emails.json`).

---

## 📋 System Requirements & Prerequisite Setup

Before running the application, make sure you configure your local environment:

1. **Ollama**: Download and install Ollama on your host machine ([Ollama Website](https://ollama.com)).
2. **AI Model**: Pull the recommended model (`llama3.2`):
   ```bash
   ollama run llama3.2
   ```
3. **Node.js**: Verify you have Node.js (version 18+) installed.
4. **Google App Password**: You must generate a Google App Password to securely access your Gmail account over IMAP. 
   > [!NOTE]
   > Normal Gmail passwords will **not** work. Go to your **Google Account settings > Security > 2-Step Verification > App Passwords**, and create a new App Password (e.g., named "Email Analyser").

### Installation & Run

1. **Clone & Enter Directory**:
   ```bash
   cd "Marketing email analyser"
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Initialize Configuration Template**:
   ```bash
   cp config.example.json config.json
   ```

4. **Run in Development Mode**:
   ```bash
   npm run dev
   ```
   This command starts the Express backend (port `3001`) and the Vite React server concurrently.

5. **Access Dashboard & Configure Settings**:
   - Open your browser and navigate to: **`http://localhost:5173`**
   - Click on the **Settings** tab to enter your Gmail address, Google App Password, and target Ollama model.
   - The web UI will automatically save and write these configurations to your local `config.json` file for you!

---

## 🔒 Security & Privacy Practices

- **Never Commit Secrets**: The `.gitignore` file is fully configured to ignore `config.json`. Always keep your Gmail credentials local.
- **Local Data Persistence**: Your emails are loaded directly from Google to your local memory/JSON database. They are never transmitted to external APIs or trackers.
- **Ollama Offline**: Because Ollama runs models locally on your system hardware, your emails are analyzed completely offline. No email text is sent to public OpenAI, Anthropic, or external server routes.

---

## 📝 License

This project is open-sourced under the MIT License. Feel free to use, modify, and distribute it!
