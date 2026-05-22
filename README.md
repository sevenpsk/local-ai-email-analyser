# 📧 Local AI Email Analyser & Deal Rater

A self-hosted, private web application designed to fetch, scan, and rate promotional emails and newsletters from your Gmail account using a local AI model (via Ollama). Keep your inbox, data, and rating models entirely private on your own hardware!

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
- **🐳 Dockerized**: Run the entire bundle in one command with Docker Compose.

---

## 🛠️ System Architecture

- **Frontend**: React + Vite (serving a beautifully designed interactive UI).
- **Backend**: Express.js server (connecting to Gmail via `imapflow`, parsing emails with `mailparser`, and sending prompt jobs to Ollama).
- **AI Model Orchestrator**: Ollama running locally (recommended models: `llama3.2:latest`, `gemma4`, or similar).
- **Database**: Local JSON file cache (`data/emails.json`).

---

## ⚡ Quick Start (Docker Compose - Recommended)

Running via Docker Compose isolates the app's Node dependencies and guarantees consistent execution.

### Prerequisites
1. **Ollama**: Installed and running on your host machine ([Download Ollama](https://ollama.ai)).
2. **AI Model**: Download your target model:
   ```bash
   ollama run llama3.2:latest
   ```
3. **Docker & Docker Compose**: Installed on your system.
4. **Google App Password**: You must generate a Google App Password to securely access your Gmail account over IMAP. 
   > [!NOTE]
   > Normal Gmail passwords will **not** work. Go to your **Google Account settings > Security > 2-Step Verification > App Passwords**, and create a new App Password (e.g., named "Email Analyser").

### Run the App

1. **Clone & Enter Directory**:
   ```bash
   cd "Marketing email analyser"
   ```

2. **Initialize Configuration File**:
   Copy the example template to create a local `config.json` file (this ensures Docker mounts a file rather than a directory):
   ```bash
   cp config.example.json config.json
   ```

3. **Spin Up the Containers**:
   ```bash
   docker compose up -d --build
   ```

4. **Access Dashboard & Configure Settings**:
   - Open your browser and navigate to: **`http://localhost:3001`**
   - Click on the **Settings** tab to enter your Gmail address, Google App Password, and target Ollama model.
   - The web UI will automatically save and write these configurations to your local `config.json` file!
   
   > [!IMPORTANT]
   > **Note on `ollamaUrl` inside Docker:**
   > When containerized, the app must connect to the host's Ollama instance. In the Settings tab, make sure your **Ollama Server Endpoint** is configured as **`http://host.docker.internal:11434`** (instead of `localhost`). This is already handled for you by the container network bridge.

---

## 💻 Local Development Setup (Without Docker)

If you prefer to run the codebase using Node.js natively:

### Prerequisites
- Node.js (v18 or higher)
- NPM
- Ollama running locally

### Installation & Run

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Prepare Configuration**:
   ```bash
   cp config.example.json config.json
   ```
   *Edit `config.json` and add your email, Gmail App Password, and keep the `ollamaUrl` as `http://localhost:11434`.*

3. **Run in Development Mode**:
   ```bash
   npm run dev
   ```
   This command starts the Express backend (port `3001`) and the Vite React server concurrently.

4. **Access UI**:
   Open **`http://localhost:5173`** (Vite default dev server).

---

## 🔒 Security & Privacy Practices

- **Never Commit Secrets**: The `.gitignore` file is fully configured to ignore `config.json`. Always keep your Gmail credentials local.
- **Local Data Persistence**: Your emails are loaded directly from Google to your local memory/JSON database. They are never transmitted to external APIs or trackers.
- **Ollama Offline**: Because Ollama runs models locally on your system hardware, your emails are analyzed completely offline. No email text is sent to public OpenAI, Anthropic, or external server routes.

---

## 📝 License

This project is open-sourced under the MIT License. Feel free to use, modify, and distribute it!
