import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'emails.json');

// Ensure data directory exists
async function ensureDbExists() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(DB_FILE);
    } catch {
      // Create empty db file if it doesn't exist
      await fs.writeFile(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Error creating database folder:', error);
  }
}

let cachedEmails = null;

export async function getEmails() {
  await ensureDbExists();
  if (cachedEmails !== null) {
    return cachedEmails;
  }
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    cachedEmails = JSON.parse(data);
    return cachedEmails;
  } catch (error) {
    console.error('Error reading emails from DB:', error);
    return [];
  }
}

export async function saveEmails(emailsToSave) {
  await ensureDbExists();
  try {
    const currentEmails = await getEmails();
    const emailMap = new Map(currentEmails.map(email => [email.messageId || email.uid.toString(), email]));

    // Update or insert new emails
    for (const email of emailsToSave) {
      const key = email.messageId || email.uid.toString();
      emailMap.set(key, email);
    }

    cachedEmails = Array.from(emailMap.values());
    // Sort by date descending (newest first)
    cachedEmails.sort((a, b) => new Date(b.date) - new Date(a.date));

    await fs.writeFile(DB_FILE, JSON.stringify(cachedEmails, null, 2), 'utf-8');
    return cachedEmails;
  } catch (error) {
    console.error('Error saving emails to DB:', error);
    throw error;
  }
}

export async function clearAllEmails() {
  await ensureDbExists();
  try {
    await fs.writeFile(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
    cachedEmails = [];
    return [];
  } catch (error) {
    console.error('Error clearing database:', error);
    throw error;
  }
}
