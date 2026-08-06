import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getEmails, saveEmails, clearAllEmails } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Config file path
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json());

// Helper: load config
async function loadConfig() {
  const defaults = {
    email: "",
    appPassword: "",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "gemma4",
    fetchLimit: 300,
    fetchOnlyUnread: false,
    useInbox: false
  };
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return { ...defaults, ...parsed };
  } catch (error) {
    // Return defaults if file missing or corrupt
    return defaults;
  }
}

// Helper: save config
async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// Helper: Query Ollama
async function analyzeEmailWithOllama(config, emailSubject, emailSender, emailText) {
  const url = `${config.ollamaUrl}/api/generate`;
  
  // Clean email text: strip tracking URLs, CSS, invisible chars, then truncate
  const cleanedText = (emailText || '')
    // Remove long tracking/redirect URLs (keep short clean ones)
    .replace(/https?:\/\/\S{80,}/g, '[link]')
    // Remove CSS blocks (sometimes text/plain still contains inline styles)
    .replace(/[\w.#-]+\s*\{[^}]*\}/g, '')
    // Remove invisible Unicode chars used for preheader padding
    .replace(/[\u200B-\u200D\u00AD\u034F\u061C\u2060\uFEFF\u180E]/g, '')
    // Remove HTML entities for invisible chars (&zwnj; &zwj; &shy; &#x200B; etc.)
    .replace(/&(zwnj|zwj|shy|#x200[B-D]|#x00AD|#xFEFF|#8203|#8204|#8205|#173);?/gi, '')
    // Strip residual HTML tags that leak into text/plain
    .replace(/<[^>]{0,500}>/g, '')
    // Collapse excessive whitespace/newlines
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const truncatedText = cleanedText.slice(0, 3000);
  
  const systemPrompt = `You are a professional email marketing analyst. Your task is to analyze the content of a promotional email and rate how good of a deal/offer it is on a scale of 0 to 10.

IMPORTANT: Look past the headline. Many promotional emails advertise a big number (e.g. "50% OFF!") but bury conditions that make the deal hard to redeem. Your rating must reflect the EFFECTIVE value to an average consumer, not the advertised headline.

CONDITIONS THAT SHOULD LOWER THE RATING:
- High minimum spend thresholds (e.g. "50% off when you spend $200+")
- Discount only applies to a tiny subset of products or clearance items
- Requires new membership sign-up, subscription, or credit card application
- "Up to X% off" where most items are discounted far less
- Stacking exclusions (e.g. "not valid on sale items, gift cards, or selected brands")
- Very short expiry window (e.g. 24 hours) that pressures impulse buying
- Multi-buy requirements (e.g. "buy 3 get 1 free" when you only need 1)

QUALITIES THAT SHOULD BOOST THE RATING:
- Easy to redeem with little or no conditions (e.g. bonus Flybuys/Everyday Rewards points on a normal shop at a reasonable spend threshold like $50-$100)
- Universally applicable discounts (site-wide, no exclusions)
- Free shipping with no minimum or a low minimum
- Automatic cashback or statement credits
- Genuine free gifts or samples with any purchase
- Loyalty point multipliers on everyday spending categories (groceries, fuel)

RATING SCALE:
- 0 to 2: No actionable offer. Informational newsletter, blog digest, product announcement, event invite, or account notification.
- 3 to 4: Weak or heavily conditional offer. The headline may look good but conditions make it impractical (e.g. "40% off with $300 min spend", "up to 60% off" on select clearance only).
- 5 to 6: Decent offer with some conditions. Moderate discount that requires reasonable effort (e.g. 20% off with $80 spend, bonus loyalty points at $100 spend, standard seasonal sale).
- 7 to 8: Strong, genuinely valuable offer. Meaningful savings that are easy to act on (e.g. 30%+ off site-wide, bonus loyalty points at everyday spend levels, free shipping no minimum, solid BOGO on popular items).
- 9 to 10: Exceptional, rare offer. Outstanding value with minimal friction (e.g. 50%+ off site-wide with no exclusions, free high-value item no strings attached, massive loyalty point bonuses, pricing errors).

You must return a JSON object with the following schema:
{
  "rating": number (0-10),
  "dealSummary": "1-sentence summary of the ACTUAL offer including any key conditions",
  "discount": "extracted discount percentage or monetary value, e.g. '30% off' or '$20 free coupon'",
  "conditionLevel": "none | low | medium | high (how conditional or restrictive the offer is)",
  "couponCodes": ["array of coupon/promo codes found, empty array if none"],
  "expirationDate": "expiration date or 'Unknown'",
  "explanation": "brief 1-2 sentence justification. Mention any hidden conditions that affected the rating."
}`;

  const userPrompt = `Subject: ${emailSubject}
Sender: ${emailSender}

Email Content:
${truncatedText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout (cold model loads can take 20-30s)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: userPrompt,
        system: systemPrompt,
        options: {
          temperature: 0.1,
          num_ctx: 2048
        },
        format: 'json',
        stream: false
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama server returned status ${response.status}`);
    }

    const result = await response.json();
    const parsedAnalysis = JSON.parse(result.response.trim());
    
    // Ensure data shape is correct
    return {
      rating: isNaN(Number(parsedAnalysis.rating)) ? 0 : Number(parsedAnalysis.rating),
      dealSummary: parsedAnalysis.dealSummary || "No deal summarized.",
      discount: Array.isArray(parsedAnalysis.discount)
        ? parsedAnalysis.discount.join(', ')
        : typeof parsedAnalysis.discount === 'string'
          ? parsedAnalysis.discount
          : parsedAnalysis.discount
            ? String(parsedAnalysis.discount)
            : "None",
      couponCodes: Array.isArray(parsedAnalysis.couponCodes) ? parsedAnalysis.couponCodes : [],
      conditionLevel: ['none','low','medium','high'].includes(parsedAnalysis.conditionLevel) ? parsedAnalysis.conditionLevel : 'unknown',
      expirationDate: parsedAnalysis.expirationDate || "Unknown",
      explanation: parsedAnalysis.explanation || "No explanation provided.",
      analyzedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Ollama analysis failed, using fallback:', error);
    return {
      rating: 0,
      dealSummary: "Failed to analyze with Ollama. Is the model running?",
      discount: "Error",
      couponCodes: [],
      expirationDate: "Error",
      explanation: `Ollama error: ${error.message}`,
      analyzedAt: new Date().toISOString(),
      error: true
    };
  }
}

// Helper: Unload Ollama Model from memory (RAM)
async function unloadOllamaModel(config) {
  const url = `${config.ollamaUrl}/api/chat`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages: [],
        keep_alive: 0
      })
    });
    if (response.ok) {
      console.log(`[Ollama] Successfully unloaded model ${config.ollamaModel} from RAM.`);
    } else {
      console.warn(`[Ollama] Failed to unload model: Status ${response.status}`);
    }
  } catch (error) {
    console.error(`[Ollama] Failed to send unload request: ${error.message}`);
  }
}

// GET Settings
app.get('/api/settings', async (req, res) => {
  const config = await loadConfig();
  res.json({
    email: config.email,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    ollamaUrl: config.ollamaUrl,
    ollamaModel: config.ollamaModel,
    fetchLimit: config.fetchLimit,
    fetchOnlyUnread: config.fetchOnlyUnread,
    useInbox: config.useInbox,
    hasPassword: !!config.appPassword
  });
});

// POST Settings
app.post('/api/settings', async (req, res) => {
  const currentConfig = await loadConfig();
  const newSettings = req.body;
  
  const updatedConfig = {
    ...currentConfig,
    email: newSettings.email ?? currentConfig.email,
    imapHost: newSettings.imapHost ?? currentConfig.imapHost,
    imapPort: newSettings.imapPort !== undefined && newSettings.imapPort !== null ? Number(newSettings.imapPort) : currentConfig.imapPort,
    ollamaUrl: newSettings.ollamaUrl ?? currentConfig.ollamaUrl,
    ollamaModel: newSettings.ollamaModel ?? currentConfig.ollamaModel,
    fetchLimit: newSettings.fetchLimit !== undefined && newSettings.fetchLimit !== null ? Number(newSettings.fetchLimit) : currentConfig.fetchLimit,
    fetchOnlyUnread: newSettings.fetchOnlyUnread !== undefined ? !!newSettings.fetchOnlyUnread : currentConfig.fetchOnlyUnread,
    useInbox: newSettings.useInbox !== undefined ? !!newSettings.useInbox : currentConfig.useInbox
  };

  // If a new password is provided, update it. If it's empty string/placeholder, don't overwrite unless requested.
  if (newSettings.appPassword !== undefined) {
    updatedConfig.appPassword = newSettings.appPassword;
  }

  await saveConfig(updatedConfig);
  res.json({ success: true, message: 'Settings saved successfully' });
});

// TEST IMAP Connection
app.post('/api/test-imap', async (req, res) => {
  const config = await loadConfig();
  const testCreds = req.body;

  const email = testCreds.email || config.email;
  const appPassword = testCreds.appPassword || config.appPassword;
  const imapHost = testCreds.imapHost || config.imapHost;
  const imapPort = Number(testCreds.imapPort) || config.imapPort;

  if (!email || !appPassword) {
    return res.status(400).json({ success: false, error: 'Email and Google App Password are required.' });
  }

  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
    connectionTimeout: 8000
  });

  try {
    await client.connect();
    await client.logout();
    res.json({ success: true, message: 'IMAP connection successful! Google App Password is correct.' });
  } catch (error) {
    res.status(500).json({ success: false, error: `IMAP connection failed: ${error.message}` });
  }
});

// TEST Ollama Connection
app.post('/api/test-ollama', async (req, res) => {
  const config = await loadConfig();
  const testSettings = req.body;

  const url = testSettings.ollamaUrl || config.ollamaUrl;
  const model = testSettings.ollamaModel || config.ollamaModel;

  try {
    const response = await fetch(`${url}/api/tags`);
    if (!response.ok) {
      throw new Error(`Local Ollama server returned status ${response.status}`);
    }
    const data = await response.json();
    const models = data.models || [];
    const modelExists = models.some(m => m.name.startsWith(model) || model.startsWith(m.name));

    res.json({
      success: true,
      message: `Connected to Ollama! Available models: ${models.map(m => m.name).join(', ')}`,
      modelExists,
      models: models.map(m => m.name)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: `Could not reach Ollama at ${url}: ${error.message}` });
  }
});

// GET Cached Emails
app.get('/api/emails', async (req, res) => {
  const emails = await getEmails();
  res.json(emails);
});

// CLEAR Cached Emails
app.post('/api/emails/clear', async (req, res) => {
  try {
    const cleared = await clearAllEmails();
    res.json({ success: true, emails: cleared });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// MARK ALL AS READ IN GMAIL
app.post('/api/emails/mark-all-read', async (req, res) => {
  const config = await loadConfig();
  if (!config.email || !config.appPassword) {
    return res.status(400).json({ success: false, error: 'Gmail credentials not configured. Please go to Settings.' });
  }

  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.email, pass: config.appPassword },
    logger: false
  });

  try {
    await client.connect();

    let promoFolder = 'INBOX';
    if (!config.useInbox) {
      const list = await client.list();
      let foundAllMail = false;
      for (const folder of list) {
        if (folder.specialUse === '\\All') {
          promoFolder = folder.path;
          foundAllMail = true;
          break;
        }
      }
      if (!foundAllMail) {
        for (const folder of list) {
          const pathName = folder.path.toLowerCase();
          if (pathName.includes('all mail') || pathName.includes('allmail') || pathName.includes('ทั้งหมด')) {
            promoFolder = folder.path;
            foundAllMail = true;
            break;
          }
        }
      }
      if (!foundAllMail) {
        promoFolder = '[Gmail]/All Mail';
      }
    }

    let lock = await client.getMailboxLock(promoFolder);
    let count = 0;

    try {
      const cachedEmails = await getEmails();
      const uidsToMark = cachedEmails.map(e => e.uid).filter(uid => uid !== undefined && uid !== null);

      if (uidsToMark.length > 0) {
        // Mark only the cached email UIDs as read in Gmail
        await client.messageFlagsAdd(uidsToMark, ['\\Seen'], { uid: true });
        count = uidsToMark.length;
      }
    } finally {
      lock.release();
    }

    await client.logout();
    res.json({ success: true, count, folder: promoFolder });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// FETCH & ANALYSE
app.get('/api/fetch', async (req, res) => {
  const config = await loadConfig();
  if (!config.email || !config.appPassword) {
    return res.status(400).json({ success: false, error: 'Gmail credentials not configured. Please go to Settings.' });
  }

  // Set response headers for Server-Sent Events (SSE) so we can stream progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('status', { message: 'Connecting to Gmail IMAP server...' });

  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.email, pass: config.appPassword },
    logger: false
  });

  try {
    await client.connect();
    
    let promoFolder = 'INBOX';
    if (config.useInbox) {
      sendEvent('status', { message: 'Using main Inbox folder.' });
    } else {
      sendEvent('status', { message: 'Listing folders and locating All Mail folder...' });
      const list = await client.list();
      let foundAllMail = false;
      for (const folder of list) {
        if (folder.specialUse === '\\All') {
          promoFolder = folder.path;
          foundAllMail = true;
          break;
        }
      }
      if (!foundAllMail) {
        for (const folder of list) {
          const pathName = folder.path.toLowerCase();
          if (pathName.includes('all mail') || pathName.includes('allmail') || pathName.includes('ทั้งหมด')) {
            promoFolder = folder.path;
            foundAllMail = true;
            break;
          }
        }
      }
      if (!foundAllMail) {
        promoFolder = '[Gmail]/All Mail';
      }
      sendEvent('status', { message: `Using folder: "${promoFolder}"` });
    }

    let lock = await client.getMailboxLock(promoFolder);
    let messagesToAnalyze = [];

    try {
      // Get already cached emails to avoid re-analysing them
      const cachedEmails = await getEmails();
      const cachedIds = new Set();
      for (const e of cachedEmails) {
        if (e.messageId) cachedIds.add(e.messageId);
        if (e.uid) cachedIds.add(e.uid.toString());
      }

      if (!config.useInbox) {
        // Promotions scan utilizing Gmail-specific search syntax in All Mail folder
        const queryStr = config.fetchOnlyUnread ? 'category:promotions is:unread' : 'category:promotions';
        sendEvent('status', { message: `Searching with Gmail query: "${queryStr}"...` });
        
        // Pass { uid: true } to search to get UIDs instead of sequence numbers
        const matchedUids = await client.search({ gmraw: queryStr }, { uid: true });
        
        if (matchedUids.length === 0) {
          sendEvent('status', { message: 'No promotional emails found.' });
          lock.release();
          await client.logout();
          sendEvent('complete', { count: 0 });
          return res.end();
        }

        // Reverse to process newest first
        const sortedUids = [...matchedUids].reverse();
        
        // Filter out UIDs that are already in our local cache so we don't request them
        const uncachedUids = sortedUids.filter(uid => !cachedIds.has(uid.toString()));

        if (uncachedUids.length === 0) {
          sendEvent('status', { message: 'All found promotional emails have already been analyzed!' });
          lock.release();
          await client.logout();
          sendEvent('complete', { count: 0 });
          return res.end();
        }

        const uidsToFetch = uncachedUids.slice(0, config.fetchLimit);

        sendEvent('status', { message: `Fetching ${uidsToFetch.length} promotional emails...` });

        for await (const message of client.fetch(uidsToFetch, { uid: true, envelope: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(message.source);
          const messageId = parsed.messageId || `${message.uid}-${message.envelope.date.getTime()}`;
          
          if (cachedIds.has(messageId)) {
            continue;
          }

          const emailData = {
            uid: message.uid,
            messageId,
            subject: parsed.subject || '(No Subject)',
            fromName: parsed.from?.value[0]?.name || parsed.from?.value[0]?.address.split('@')[0] || 'Unknown Sender',
            fromAddress: parsed.from?.value[0]?.address || 'unknown@sender.com',
            date: parsed.date || message.envelope.date || new Date(),
            html: parsed.html || `<div style="font-family: sans-serif; padding: 20px;">${parsed.textAsHtml || parsed.text || ''}</div>`,
            text: parsed.text || ""
          };

          messagesToAnalyze.push(emailData);
        }
      } else {
        // Inbox scan logic
        if (config.fetchOnlyUnread) {
          sendEvent('status', { message: 'Searching for unread emails in Inbox...' });
          
          // Pass { uid: true } to search to get UIDs instead of sequence numbers
          const unreadUids = await client.search({ seen: false }, { uid: true });
          
          if (unreadUids.length === 0) {
            sendEvent('status', { message: 'No unread emails found in Inbox.' });
            lock.release();
            await client.logout();
            sendEvent('complete', { count: 0 });
            return res.end();
          }

          // Reverse to process newest first
          const sortedUids = [...unreadUids].reverse();
          
          // Filter out UIDs that are already in our local cache so we don't request them
          const uncachedUids = sortedUids.filter(uid => !cachedIds.has(uid.toString()));

          if (uncachedUids.length === 0) {
            sendEvent('status', { message: 'All found unread Inbox emails have already been analyzed!' });
            lock.release();
            await client.logout();
            sendEvent('complete', { count: 0 });
            return res.end();
          }

          const uidsToFetch = uncachedUids.slice(0, config.fetchLimit);

          sendEvent('status', { message: `Fetching ${uidsToFetch.length} unread emails...` });

          for await (const message of client.fetch(uidsToFetch, { uid: true, envelope: true, source: true }, { uid: true })) {
            const parsed = await simpleParser(message.source);
            const messageId = parsed.messageId || `${message.uid}-${message.envelope.date.getTime()}`;
            
            if (cachedIds.has(messageId)) {
              continue;
            }

            const emailData = {
              uid: message.uid,
              messageId,
              subject: parsed.subject || '(No Subject)',
              fromName: parsed.from?.value[0]?.name || parsed.from?.value[0]?.address.split('@')[0] || 'Unknown Sender',
              fromAddress: parsed.from?.value[0]?.address || 'unknown@sender.com',
              date: parsed.date || message.envelope.date || new Date(),
              html: parsed.html || `<div style="font-family: sans-serif; padding: 20px;">${parsed.textAsHtml || parsed.text || ''}</div>`,
              text: parsed.text || ""
            };

            messagesToAnalyze.push(emailData);
          }
        } else {
          const status = await client.status(promoFolder, { messages: true });
          const totalMessages = status.messages;
          
          if (totalMessages === 0) {
            sendEvent('status', { message: 'No messages found in Inbox.' });
            lock.release();
            await client.logout();
            sendEvent('complete', { count: 0 });
            return res.end();
          }

          const fetchCount = Math.min(config.fetchLimit, totalMessages);
          const start = Math.max(1, totalMessages - fetchCount + 1);
          const range = `${start}:${totalMessages}`;

          sendEvent('status', { message: `Fetching the last ${fetchCount} emails...` });

          for await (const message of client.fetch(range, { uid: true, envelope: true, source: true })) {
            const parsed = await simpleParser(message.source);
            const messageId = parsed.messageId || `${message.uid}-${message.envelope.date.getTime()}`;
            
            if (cachedIds.has(messageId)) {
              continue;
            }

            const emailData = {
              uid: message.uid,
              messageId,
              subject: parsed.subject || '(No Subject)',
              fromName: parsed.from?.value[0]?.name || parsed.from?.value[0]?.address.split('@')[0] || 'Unknown Sender',
              fromAddress: parsed.from?.value[0]?.address || 'unknown@sender.com',
              date: parsed.date || message.envelope.date || new Date(),
              html: parsed.html || `<div style="font-family: sans-serif; padding: 20px;">${parsed.textAsHtml || parsed.text || ''}</div>`,
              text: parsed.text || ""
            };

            messagesToAnalyze.push(emailData);
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    if (messagesToAnalyze.length === 0) {
      sendEvent('status', { message: 'All fetched emails have already been analyzed!' });
      sendEvent('complete', { count: 0 });
      return res.end();
    }

    sendEvent('status', { message: `Found ${messagesToAnalyze.length} new emails to analyze. Starting local AI processing...` });

    // Reverse so we analyze oldest to newest (or newest first, but let's go one by one and stream updates)
    // We reverse it to preserve chronological sorting easily when saving
    messagesToAnalyze.reverse();

    const analyzedEmails = [];
    for (let i = 0; i < messagesToAnalyze.length; i++) {
      const email = messagesToAnalyze[i];
      sendEvent('progress', { 
        current: i + 1, 
        total: messagesToAnalyze.length, 
        subject: email.subject 
      });

      const analysis = await analyzeEmailWithOllama(
        config, 
        email.subject, 
        `${email.fromName} <${email.fromAddress}>`, 
        email.text
      );

      const completeEmail = {
        ...email,
        analysis
      };

      // Save each email directly to DB as we parse it so if we stop or crash we don't lose progress
      await saveEmails([completeEmail]);
      analyzedEmails.push(completeEmail);

      // Reset RAM creep by unloading model every 30 emails during a long scan
      if ((i + 1) % 30 === 0 && i < messagesToAnalyze.length - 1) {
        sendEvent('status', { message: `Optimizing system memory (releasing Ollama RAM after ${i + 1} emails)...` });
        await unloadOllamaModel(config);
      }
    }

    // Unload Ollama model from memory at the end of the batch to free up RAM
    if (analyzedEmails.length > 0) {
      sendEvent('status', { message: 'Releasing Ollama model from memory after final batch...' });
      await unloadOllamaModel(config);
    }

    sendEvent('complete', { count: analyzedEmails.length });
    res.end();

  } catch (error) {
    console.error('Fetch and analyze error:', error);
    sendEvent('fetch-error', { message: `Failed: ${error.message}` });
    res.end();
  }
});

// Serve frontend assets in production (if built)
const buildPath = path.join(__dirname, 'dist');
app.use(express.static(buildPath));

app.get('*', (req, res) => {
  // If request is not an API call, serve React index.html
  if (!req.url.startsWith('/api/')) {
    res.sendFile(path.join(buildPath, 'index.html'), err => {
      if (err) {
        // In development, dist might not exist yet, which is fine
        if (!res.headersSent) {
          res.status(404).send('Vite Dev Server is running. Please open the client port.');
        }
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
