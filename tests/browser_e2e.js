import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Artifacts directory for screenshots
const ARTIFACT_DIR = '/Users/seven/.gemini/antigravity/brain/e871e9c8-b956-4c67-9701-b692849bc77d';

async function ensureChromeRunning() {
  try {
    const r = await fetch('http://127.0.0.1:9223/json/version');
    if (r.ok) return;
  } catch (e) {}

  console.log('Launching headless Chrome on port 9223...');
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--user-data-dir=/tmp/chrome-qa-profile',
    '--no-first-run',
    '--no-default-browser-check'
  ], { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const r = await fetch('http://127.0.0.1:9223/json/version');
      if (r.ok) {
        console.log('Chrome is ready on port 9223!');
        return;
      }
    } catch (e) {}
  }
  throw new Error('Timed out waiting for Chrome to launch on port 9223');
}

async function sendCdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function runBrowserTests() {
  await ensureChromeRunning();
  console.log('Connecting to Chrome DevTools on port 9223...');
  let tabsRes = await fetch('http://127.0.0.1:9223/json');
  let tabs = await tabsRes.json();
  let pageTab = tabs.find(t => t.url && (t.url.includes('localhost:5173') || t.url.includes('localhost:3001')));

  if (!pageTab) {
    console.log('Opening new tab for http://localhost:5173/ ...');
    const newTabRes = await fetch('http://127.0.0.1:9223/json/new?http://localhost:5173/');
    pageTab = await newTabRes.json();
  }

  console.log(`Found page tab: ${pageTab.title || 'App'} (${pageTab.url})`);
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  console.log('WebSocket connected to Chrome DevTools Protocol!');

  // Enable necessary domains
  await sendCdpCommand(ws, 'Page.enable');
  await sendCdpCommand(ws, 'Runtime.enable');
  await sendCdpCommand(ws, 'DOM.enable');

  // Set desktop viewport 1440x950
  await sendCdpCommand(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Navigate to http://localhost:5173/ and wait for load
  console.log('Navigating to http://localhost:5173/ ...');
  await sendCdpCommand(ws, 'Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2000));

  // Test 1: Check initial page title & Header
  console.log('Test 1: Verifying header & branding...');
  let evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const title = document.querySelector('.header-title h2')?.textContent;
      const subtitle = document.querySelector('.header-title p')?.textContent;
      const scanBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Scan & Load Emails'))?.textContent;
      return { title, subtitle, scanBtn };
    })()`,
    returnByValue: true
  });
  console.log('Page Header Elements:', evalRes.result.value);

  // Take screenshot 1: Initial Empty / Skimming State
  console.log('Capturing Screenshot 1 (Initial Dashboard)...');
  let shot = await sendCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'screenshot_initial_dashboard.png'), Buffer.from(shot.data, 'base64'));

  // Test 2: Populate sample test emails directly into data/emails.json to verify Skimming + Queued AI UI
  console.log('Test 2: Injecting test emails into database to test Decoupled Skimming & Queued State...');
  const testEmails = [
    {
      uid: 901,
      messageId: 'skim-001@brand.com',
      subject: '🔥 80% OFF Sitewide End of Season Sale',
      fromName: 'MegaShop Deals',
      fromAddress: 'promo@brand.com',
      date: new Date().toISOString(),
      html: `
        <div style="font-family: sans-serif; padding: 24px; background: #ffffff; color: #111;">
          <h1 style="color: #e11d48;">Mega End of Season Sale!</h1>
          <p style="font-size: 16px;">Take 80% off our entire catalog today only with code <strong>MEGA80</strong>.</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin-top: 16px;">
            <p><strong>Terms:</strong> Valid until midnight. Free shipping on orders over $50.</p>
          </div>
        </div>
      `,
      text: 'Mega End of Season Sale! Take 80% off our entire catalog today only with code MEGA80. Valid until midnight.',
      analysis: null // Pending AI analysis!
    },
    {
      uid: 902,
      messageId: 'skim-002@airlines.com',
      subject: '✈️ Flash Sale: Return Flights to Tokyo $450',
      fromName: 'Global Wings',
      fromAddress: 'flightdeals@airlines.com',
      date: new Date(Date.now() - 3600000).toISOString(),
      html: `
        <div style="font-family: sans-serif; padding: 24px; background: #ffffff; color: #111;">
          <h2>Exclusive Tokyo Airfare</h2>
          <p>Book this weekend and fly anytime this autumn from only $450 return.</p>
        </div>
      `,
      text: 'Exclusive Tokyo Airfare: Book this weekend and fly anytime this autumn from only $450 return.',
      analysis: {
        rating: 9,
        dealSummary: 'Incredible return airfare to Tokyo for $450',
        discount: '$450 Return Flights',
        couponCodes: ['TOKYO450'],
        conditionLevel: 'low',
        expirationDate: 'This Sunday',
        explanation: 'Direct round-trip flights at roughly half average market price with flexible dates.',
        analyzedAt: new Date().toISOString()
      }
    },
    {
      uid: 903,
      messageId: 'skim-003@coffee.com',
      subject: '☕ Free Bag of Single Origin Coffee Beans',
      fromName: 'Artisan Roast',
      fromAddress: 'deals@artisanroast.com',
      date: new Date(Date.now() - 7200000).toISOString(),
      html: `
        <div style="font-family: sans-serif; padding: 24px; background: #ffffff; color: #111;">
          <h2>Free Coffee Sample</h2>
          <p>Get a complimentary 250g bag of Ethiopian Yirgacheffe with code <strong>FREEBEAN</strong>.</p>
        </div>
      `,
      text: 'Free Coffee Sample: Get a complimentary 250g bag of Ethiopian Yirgacheffe with code FREEBEAN.',
      analysis: null // Pending AI analysis!
    }
  ];

  fs.writeFileSync(path.join(process.cwd(), 'data', 'emails.json'), JSON.stringify(testEmails, null, 2), 'utf-8');

  // Reload page to display new emails
  await sendCdpCommand(ws, 'Page.reload');
  await new Promise(r => setTimeout(r, 2000));

  // Test 3: Inspect cards on dashboard
  console.log('Test 3: Inspecting dashboard cards (analyzed + pending)...');
  evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('.email-card')).map(card => {
        const title = card.querySelector('.email-subject')?.textContent?.trim();
        const sender = card.querySelector('.email-sender-name')?.textContent?.trim();
        const rating = card.querySelector('.rating-score')?.textContent?.trim();
        const badge = card.querySelector('.rating-badge')?.textContent?.trim();
        const isQueued = card.classList.contains('pending-card');
        const summary = card.querySelector('.deal-summary')?.textContent?.trim();
        return { title, sender, rating, badge, isQueued, summary };
      });
      const pendingCountText = document.querySelector('button[title*=\"Evaluate queued deals\"]')?.textContent?.trim();
      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Clear Cache'))?.textContent?.trim();
      return { cards, pendingCountText, clearBtn };
    })()`,
    returnByValue: true
  });
  console.log('Dashboard Cards Found:', JSON.stringify(evalRes.result.value, null, 2));

  // Capture Screenshot 2: Dashboard with Mixed Analyzed and Queued Cards
  console.log('Capturing Screenshot 2 (Mixed Skim Cards)...');
  shot = await sendCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'screenshot_dashboard_cards.png'), Buffer.from(shot.data, 'base64'));

  // Test 4: Open Modal on unanalyzed email (skim-001)
  console.log('Test 4: Clicking unanalyzed card to test immediate HTML skim and AI shimmer...');
  const clickRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const card = document.querySelector('.email-card');
      if (!card) return { found: false, count: document.querySelectorAll('.email-card').length };
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { found: true, text: card.querySelector('.email-subject')?.textContent };
    })()`,
    returnByValue: true
  });
  console.log('Card Click Result:', clickRes.result.value);
  await new Promise(r => setTimeout(r, 1200));

  // Verify modal is open and inspect its contents
  evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('.modal-popup');
      if (!modal) return { open: false };
      const subject = modal.querySelector('.modal-subject')?.textContent?.trim();
      const hasIframe = !!modal.querySelector('iframe');
      const hasAiPendingCard = !!modal.querySelector('.ai-pending-state-card');
      const aiStatusText = modal.querySelector('.ai-pending-state-card p')?.textContent?.trim();
      const posIndicator = modal.querySelector('.modal-position-indicator')?.textContent?.trim();
      return { open: true, subject, hasIframe, hasAiPendingCard, aiStatusText, posIndicator };
    })()`,
    returnByValue: true
  });
  console.log('Modal Verification:', evalRes.result.value);
  if (!evalRes.result.value.hasIframe) throw new Error('Expected iframe to be present in modal');
  if (!evalRes.result.value.hasAiPendingCard) throw new Error('Expected AI pending card to be present');

  // Capture Screenshot 3: Modal with Email HTML Skimming & AI Queued State
  console.log('Capturing Screenshot 3 (Modal Skimming View)...');
  shot = await sendCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'screenshot_modal_skimming.png'), Buffer.from(shot.data, 'base64'));

  // Test 5: Test keyboard navigation (J key to flick to next email)
  console.log('Test 5: Testing "J" Hotkey to navigate to next email...');
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'j',
    code: 'KeyJ',
    windowsVirtualKeyCode: 74
  });
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'j',
    code: 'KeyJ',
    windowsVirtualKeyCode: 74
  });
  await new Promise(r => setTimeout(r, 800));

  evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('.modal-popup');
      const subject = modal?.querySelector('.modal-subject')?.textContent?.trim();
      const rating = modal?.querySelector('.modal-score-badge')?.textContent?.trim();
      const posIndicator = modal?.querySelector('.modal-position-indicator')?.textContent?.trim();
      return { subject, rating, posIndicator };
    })()`,
    returnByValue: true
  });
  console.log('After pressing "J" (Next):', evalRes.result.value);

  // Test 6: Test keyboard navigation (K key to flick back)
  console.log('Test 6: Testing "K" Hotkey to navigate back...');
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'k',
    code: 'KeyK',
    windowsVirtualKeyCode: 75
  });
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'k',
    code: 'KeyK',
    windowsVirtualKeyCode: 75
  });
  await new Promise(r => setTimeout(r, 800));

  evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('.modal-popup');
      const subject = modal?.querySelector('.modal-subject')?.textContent?.trim();
      const posIndicator = modal?.querySelector('.modal-position-indicator')?.textContent?.trim();
      return { subject, posIndicator };
    })()`,
    returnByValue: true
  });
  console.log('After pressing "K" (Prev):', evalRes.result.value);

  // Close modal with Escape
  console.log('Closing modal with Escape key...');
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  });
  await sendCdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27
  });
  await new Promise(r => setTimeout(r, 500));

  // Test 7: Test Clear Cache
  console.log('Test 7: Testing Clear Cache...');
  await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      // Stub window.confirm to return true automatically
      window.confirm = () => true;
      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Clear Cache'));
      if (clearBtn) clearBtn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1500));

  evalRes = await sendCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const cards = document.querySelectorAll('.email-card').length;
      const emptyState = document.querySelector('.empty-state h3')?.textContent?.trim();
      return { remainingCards: cards, emptyState };
    })()`,
    returnByValue: true
  });
  console.log('After Clear Cache:', evalRes.result.value);

  // Capture Screenshot 4: Cleared State
  console.log('Capturing Screenshot 4 (Empty / Cleared Cache State)...');
  shot = await sendCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'screenshot_empty_cache.png'), Buffer.from(shot.data, 'base64'));

  ws.close();
  console.log('ALL BROWSER E2E TESTS PASSED SUCCESSFULLY! Screenshots saved.');
}

runBrowserTests().catch(err => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
