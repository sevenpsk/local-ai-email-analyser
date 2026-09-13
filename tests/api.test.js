import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmails, saveEmails, updateEmailAnalysis, clearAllEmails } from '../db.js';

test('Database Operations: save, retrieve, update analysis, clear', async (t) => {
  // 1. Clear database
  await clearAllEmails();
  const initial = await getEmails();
  assert.equal(initial.length, 0, 'Database should be empty after clear');

  // 2. Save raw emails with analysis: null (Phase 1 fast ingestion)
  const rawEmails = [
    {
      uid: 101,
      messageId: 'msg-101@promo.com',
      subject: '50% Off Everything Today Only!',
      fromName: 'MegaStore',
      fromAddress: 'deals@megastore.com',
      date: new Date('2026-09-01T10:00:00Z'),
      html: '<h1>Huge Sale</h1><p>Enjoy 50% off storewide.</p>',
      text: 'Huge Sale: Enjoy 50% off storewide with code HALF50',
      analysis: null
    },
    {
      uid: 102,
      messageId: 'msg-102@coffee.com',
      subject: 'Free Coffee Sample Pack',
      fromName: 'RoastCo',
      fromAddress: 'hello@roastco.com',
      date: new Date('2026-09-02T12:00:00Z'),
      html: '<h1>Free Coffee</h1><p>Claim your free sample.</p>',
      text: 'Free coffee sample pack with free shipping.',
      analysis: null
    }
  ];

  await saveEmails(rawEmails);
  const fetched = await getEmails();
  assert.equal(fetched.length, 2, 'Should have saved 2 raw emails');
  assert.equal(fetched[0].analysis, null, 'Raw email should have analysis: null');

  // 3. Update email analysis (Phase 2 background analysis)
  const analysisPayload = {
    rating: 9,
    dealSummary: 'Genuine 50% off storewide with no exclusions',
    discount: '50% off',
    couponCodes: ['HALF50'],
    conditionLevel: 'low',
    expirationDate: 'Today',
    explanation: 'Exceptional site-wide discount',
    analyzedAt: new Date().toISOString()
  };

  const updated = await updateEmailAnalysis('msg-101@promo.com', analysisPayload);
  assert.ok(updated, 'Should find and update the email');
  assert.equal(updated.analysis.rating, 9);
  assert.equal(updated.analysis.discount, '50% off');
  assert.equal(updated.analysis.couponCodes[0], 'HALF50');

  // Verify persistence
  const reloaded = await getEmails();
  const found101 = reloaded.find(e => e.messageId === 'msg-101@promo.com');
  const found102 = reloaded.find(e => e.messageId === 'msg-102@coffee.com');
  assert.equal(found101.analysis.rating, 9);
  assert.equal(found102.analysis, null, 'Email 102 should still be unanalyzed');

  // 4. Test clear
  await clearAllEmails();
  const afterClear = await getEmails();
  assert.equal(afterClear.length, 0, 'Database should be empty after clearAllEmails');
});

test('Filter & Search Logic for mixed analyzed and unanalyzed emails', async (t) => {
  const sampleEmails = [
    {
      uid: 1,
      messageId: 'analyzed-epic',
      subject: '90% Off Flight Tickets',
      fromName: 'Airlines',
      fromAddress: 'fly@air.com',
      text: 'Cheap flights today',
      analysis: { rating: 10, dealSummary: 'Epic discount on flights' }
    },
    {
      uid: 2,
      messageId: 'analyzed-weak',
      subject: 'Save 5% on orders over $500',
      fromName: 'Luxury Shop',
      fromAddress: 'info@luxury.com',
      text: 'Tiny discount with high minimum spend',
      analysis: { rating: 2, dealSummary: 'Weak conditional offer' }
    },
    {
      uid: 3,
      messageId: 'pending-email',
      subject: 'Secret VIP Weekend Pass',
      fromName: 'ConcertClub',
      fromAddress: 'vip@concert.com',
      text: 'Exclusive free entry to weekend festival',
      analysis: null
    }
  ];

  // Logic test 1: minRating = 0 shows ALL emails (analyzed + pending)
  const minRatingZero = sampleEmails.filter(email => {
    const isAnalyzed = email.analysis && !email.analysis.pending;
    const score = isAnalyzed ? (email.analysis.rating ?? 0) : 0;
    return true;
  });
  assert.equal(minRatingZero.length, 3, 'minRating 0 should show all 3 emails');

  // Logic test 2: minRating = 8 only shows analyzed emails >= 8
  const minRatingEight = sampleEmails.filter(email => {
    const isAnalyzed = email.analysis && !email.analysis.pending;
    const score = isAnalyzed ? (email.analysis.rating ?? 0) : 0;
    return isAnalyzed && score >= 8;
  });
  assert.equal(minRatingEight.length, 1, 'minRating 8 should only show analyzed-epic');
  assert.equal(minRatingEight[0].messageId, 'analyzed-epic');

  // Logic test 3: Search searches raw text for unanalyzed emails
  const term = 'festival';
  const searchResults = sampleEmails.filter(email => {
    const isAnalyzed = email.analysis && !email.analysis.pending;
    return (
      email.subject.toLowerCase().includes(term) ||
      email.fromName.toLowerCase().includes(term) ||
      (email.analysis?.dealSummary || '').toLowerCase().includes(term) ||
      (!isAnalyzed && (email.text || '').toLowerCase().includes(term))
    );
  });
  assert.equal(searchResults.length, 1, 'Should find pending email via raw text keyword "festival"');
  assert.equal(searchResults[0].messageId, 'pending-email');
});
