import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmails, saveEmails, updateEmailAnalysis, clearAllEmails } from '../db.js';

test('E2E Flow: Decoupled Fast Ingestion, Skimming, Background Analysis, Hotkeys, and Clear Cache', async (t) => {
  // Step 1: Initial state - Clear cache
  await clearAllEmails();
  let emails = await getEmails();
  assert.equal(emails.length, 0, 'Step 1: Cache must be completely empty after clear');

  // Step 2: Fast Ingestion (Phase 1)
  // Simulate fetching 4 emails from IMAP: all saved immediately with analysis: null
  const fetchedEmails = [
    {
      uid: 501,
      messageId: 'deal-001@shop.com',
      subject: '70% Off Outdoor Gear - Flash Sale',
      fromName: 'CampGear',
      fromAddress: 'promo@campgear.com',
      date: new Date('2026-09-10T08:00:00Z'),
      html: '<div class="promo"><h1>Flash Sale</h1><p>Use code CAMP70 for 70% off all tents.</p></div>',
      text: 'Flash Sale: Use code CAMP70 for 70% off all tents. Expires tonight at midnight.',
      analysis: null
    },
    {
      uid: 502,
      messageId: 'deal-002@tech.com',
      subject: 'New M4 MacBook Pro In Stock',
      fromName: 'TechStore',
      fromAddress: 'news@techstore.com',
      date: new Date('2026-09-10T09:00:00Z'),
      html: '<div><h1>M4 MacBook Pro</h1><p>Starting at $1999.</p></div>',
      text: 'The new M4 MacBook Pro is now available. Order today for delivery tomorrow.',
      analysis: null
    },
    {
      uid: 503,
      messageId: 'deal-003@travel.com',
      subject: 'Weekend Flights to Tokyo from $399',
      fromName: 'FlyNow',
      fromAddress: 'deals@flynow.com',
      date: new Date('2026-09-10T10:00:00Z'),
      html: '<div>Fly to Tokyo for just $399 return! Limited seats with voucher FLYTOKYO.</div>',
      text: 'Fly to Tokyo for just $399 return! Limited seats with voucher FLYTOKYO. Book by Friday.',
      analysis: null
    },
    {
      uid: 504,
      messageId: 'deal-004@clothing.com',
      subject: 'Buy 1 Get 1 Free on All Sweaters',
      fromName: 'WarmKnits',
      fromAddress: 'offers@warmknits.com',
      date: new Date('2026-09-10T11:00:00Z'),
      html: '<div>BOGO on sweaters today!</div>',
      text: 'Buy 1 Get 1 Free on all winter sweaters with promo code BOGOKNIT.',
      analysis: null
    }
  ];

  const startTime = Date.now();
  await saveEmails(fetchedEmails);
  const ingestionDuration = Date.now() - startTime;
  assert.ok(ingestionDuration < 500, `Fast ingestion should complete in <500ms, took ${ingestionDuration}ms`);

  emails = await getEmails();
  assert.equal(emails.length, 4, 'Step 2: Dashboard should immediately show all 4 fetched emails');

  // Step 3: Skimming validation while AI is pending
  // Verify user can skim: subject, sender, date, raw snippet available immediately
  for (const email of emails) {
    assert.ok(email.subject, 'Subject must be populated for skimming');
    assert.ok(email.fromName, 'Sender must be populated for skimming');
    assert.ok(email.html, 'Full HTML must be intact for modal viewing');
    assert.equal(email.analysis, null, 'Analysis must be null while AI is running in background');

    // Frontend display logic validation for unanalyzed cards:
    const isAnalyzed = Boolean(email.analysis && !email.analysis.pending);
    const badgeText = isAnalyzed ? `${email.analysis.rating}/10` : '⏳ Queued';
    const snippetText = isAnalyzed ? email.analysis.dealSummary : (email.text || '').slice(0, 120);

    assert.equal(badgeText, '⏳ Queued', 'Unanalyzed card should show Queued badge');
    assert.ok(snippetText.length > 0, 'Unanalyzed card must preview raw text snippet for instant skim');
  }

  // Step 4: Hotkey Navigation logic validation (J / K shortcuts)
  let selectedIndex = 0;
  const navigate = (direction, listLength) => {
    if (direction === 'down') {
      return Math.min(selectedIndex + 1, listLength - 1);
    } else if (direction === 'up') {
      return Math.max(selectedIndex - 1, 0);
    }
    return selectedIndex;
  };

  // User presses 'J' (Down) to flick through emails
  // Newest first order: deal-004 (11:00), deal-003 (10:00), deal-002 (09:00), deal-001 (08:00)
  assert.equal(emails[0].messageId, 'deal-004@clothing.com', 'Index 0 is newest');

  selectedIndex = navigate('down', emails.length);
  assert.equal(selectedIndex, 1, 'Pressing J should move from index 0 to index 1');
  assert.equal(emails[selectedIndex].messageId, 'deal-003@travel.com');

  selectedIndex = navigate('down', emails.length);
  assert.equal(selectedIndex, 2, 'Pressing J should move from index 1 to index 2');
  assert.equal(emails[selectedIndex].messageId, 'deal-002@tech.com');

  selectedIndex = navigate('down', emails.length);
  assert.equal(selectedIndex, 3, 'Pressing J should move to last email (index 3)');
  assert.equal(emails[selectedIndex].messageId, 'deal-001@shop.com');

  // Clamping at boundary
  selectedIndex = navigate('down', emails.length);
  assert.equal(selectedIndex, 3, 'Pressing J at bottom should clamp to last email');

  // User presses 'K' (Up) to flick backwards
  selectedIndex = navigate('up', emails.length);
  assert.equal(selectedIndex, 2, 'Pressing K should move from index 3 to index 2');

  selectedIndex = 0;
  selectedIndex = navigate('up', emails.length);
  assert.equal(selectedIndex, 0, 'Pressing K at top should clamp to index 0');

  // Step 5: Background Analysis (Phase 2)
  // Simulate AI analyzing email 1 and email 3
  const analysis1 = {
    rating: 9,
    dealSummary: '70% off outdoor gear and camping tents with CAMP70',
    discount: '70% off',
    couponCodes: ['CAMP70'],
    conditionLevel: 'low',
    expirationDate: 'Midnight tonight',
    explanation: 'Huge discount on high quality gear with minimal restrictions.',
    analyzedAt: new Date().toISOString()
  };

  const analysis3 = {
    rating: 8,
    dealSummary: '$399 roundtrip flights to Tokyo with voucher FLYTOKYO',
    discount: 'Cheap flights',
    couponCodes: ['FLYTOKYO'],
    conditionLevel: 'medium',
    expirationDate: 'Friday',
    explanation: 'Great airfare deal subject to seat availability.',
    analyzedAt: new Date().toISOString()
  };

  await updateEmailAnalysis('deal-001@shop.com', analysis1);
  await updateEmailAnalysis('deal-003@travel.com', analysis3);

  emails = await getEmails();
  const e1 = emails.find(e => e.messageId === 'deal-001@shop.com');
  const e2 = emails.find(e => e.messageId === 'deal-002@tech.com');
  const e3 = emails.find(e => e.messageId === 'deal-003@travel.com');
  const e4 = emails.find(e => e.messageId === 'deal-004@clothing.com');

  assert.equal(e1.analysis?.rating, 9, 'Email 1 should now be analyzed with rating 9');
  assert.equal(e2.analysis, null, 'Email 2 should still be unanalyzed in queue');
  assert.equal(e3.analysis?.rating, 8, 'Email 3 should now be analyzed with rating 8');
  assert.equal(e4.analysis, null, 'Email 4 should still be unanalyzed in queue');

  // Step 6: Filter and Stats with Mixed State
  const pendingCount = emails.filter(e => !e.analysis || e.analysis.pending).length;
  const analyzedCount = emails.filter(e => e.analysis && !e.analysis.pending).length;
  assert.equal(pendingCount, 2, 'Should have exactly 2 pending emails');
  assert.equal(analyzedCount, 2, 'Should have exactly 2 analyzed emails');

  // Filter: minRating = 0 includes both pending and analyzed
  const allDeals = emails.filter(email => {
    const isAnalyzed = email.analysis && !email.analysis.pending;
    return !isAnalyzed || (email.analysis.rating >= 0);
  });
  assert.equal(allDeals.length, 4, 'minRating 0 must include all emails (pending + rated)');

  // Filter: minRating = 9 only shows deal-001
  const epicDeals = emails.filter(email => {
    const isAnalyzed = email.analysis && !email.analysis.pending;
    return isAnalyzed && email.analysis.rating >= 9;
  });
  assert.equal(epicDeals.length, 1, 'minRating 9 must filter to only deal-001');
  assert.equal(epicDeals[0].messageId, 'deal-001@shop.com');

  // Step 7: Clear Cache
  await clearAllEmails();
  const finalEmails = await getEmails();
  assert.equal(finalEmails.length, 0, 'Step 7: Clear cache must remove all emails');
});
