import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:3001/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState('date-desc');

  // Configuration states
  const [settings, setSettings] = useState({
    email: '',
    appPassword: '',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'gemma4',
    fetchLimit: 10,
    fetchOnlyUnread: false,
    useInbox: false,
    hasPassword: false
  });
  
  // Custom states for settings inputs
  const [passwordInput, setPasswordInput] = useState('');
  const [settingsStatus, setSettingsStatus] = useState({ type: '', message: '' });
  const [imapTestStatus, setImapTestStatus] = useState({ type: '', message: '' });
  const [ollamaTestStatus, setOllamaTestStatus] = useState({ type: '', message: '' });
  const [isMarkingRead, setIsMarkingRead] = useState(false);

  // Fetching progression overlay states
  const [fetchProgress, setFetchProgress] = useState({
    active: false,
    status: '',
    current: 0,
    total: 0,
    subject: ''
  });

  // Copied indicator feedback state
  const [copiedCode, setCopiedCode] = useState(null);

  // Load emails and settings on mount
  useEffect(() => {
    fetchEmails();
    fetchSettings();
  }, []);

  const fetchEmails = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/emails`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data);
      }
    } catch (err) {
      console.error('Error fetching emails:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setPasswordInput('');
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSettingsStatus({ type: 'loading', message: 'Saving settings...' });
    try {
      const body = { ...settings };
      if (passwordInput) {
        body.appPassword = passwordInput;
      }
      
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setSettingsStatus({ type: 'success', message: 'Settings saved successfully!' });
        fetchSettings();
        setTimeout(() => setSettingsStatus({ type: '', message: '' }), 3000);
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (err) {
      setSettingsStatus({ type: 'error', message: err.message });
    }
  };

  const testImapConnection = async () => {
    setImapTestStatus({ type: 'loading', message: 'Testing IMAP connection...' });
    try {
      const body = {
        email: settings.email,
        imapHost: settings.imapHost,
        imapPort: settings.imapPort
      };
      if (passwordInput) {
        body.appPassword = passwordInput;
      }

      const res = await fetch(`${API_BASE}/test-imap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setImapTestStatus({ type: 'success', message: data.message });
      } else {
        setImapTestStatus({ type: 'error', message: data.error || 'Connection failed' });
      }
    } catch (err) {
      setImapTestStatus({ type: 'error', message: `Test failed: ${err.message}` });
    }
  };

  const testOllamaConnection = async () => {
    setOllamaTestStatus({ type: 'loading', message: 'Connecting to Ollama...' });
    try {
      const res = await fetch(`${API_BASE}/test-ollama`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollamaUrl: settings.ollamaUrl,
          ollamaModel: settings.ollamaModel
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.modelExists) {
          setOllamaTestStatus({ 
            type: 'success', 
            message: `Connected! Model '${settings.ollamaModel}' is ready.` 
          });
        } else {
          setOllamaTestStatus({ 
            type: 'warning', 
            message: `Connected, but model '${settings.ollamaModel}' was not found. Available models: ${data.models.join(', ')}` 
          });
        }
      } else {
        setOllamaTestStatus({ type: 'error', message: data.error || 'Connection failed' });
      }
    } catch (err) {
      setOllamaTestStatus({ type: 'error', message: `Could not reach Ollama: ${err.message}` });
    }
  };

  // Trigger server-side fetch with live progress monitoring (SSE)
  const triggerEmailFetch = () => {
    if (!settings.email || (!settings.hasPassword && !passwordInput)) {
      alert('Please set up your Gmail email and Google App Password in the Settings tab first.');
      setActiveTab('settings');
      return;
    }

    setFetchProgress({
      active: true,
      status: 'Initializing local AI analyser engine...',
      current: 0,
      total: 0,
      subject: ''
    });

    const eventSource = new EventSource(`${API_BASE}/fetch`);

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setFetchProgress(prev => ({ ...prev, status: data.message }));
    });

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      setFetchProgress(prev => ({
        ...prev,
        status: `Processing promotional content with Local AI...`,
        current: data.current,
        total: data.total,
        subject: data.subject
      }));
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      setFetchProgress(prev => ({
        ...prev,
        status: `Analysis completed! Processed ${data.count} new deals.`,
        current: prev.total,
        active: false
      }));
      eventSource.close();
      fetchEmails();
    });

    eventSource.addEventListener('fetch-error', (e) => {
      const data = JSON.parse(e.data);
      alert(`Error scanning emails: ${data.message}`);
      setFetchProgress(prev => ({ ...prev, active: false }));
      eventSource.close();
      fetchEmails();
    });

    eventSource.addEventListener('error', (e) => {
      // General connection failure
      if (eventSource.readyState === EventSource.CLOSED) {
        alert("Error scanning emails: Connection to the local backend server was lost.");
        setFetchProgress(prev => ({ ...prev, active: false }));
        eventSource.close();
        fetchEmails();
      }
    });

    // Fallback: close connection if the user leaves
    return () => {
      eventSource.close();
    };
  };

  const clearAllCachedData = async () => {
    if (confirm('Are you sure you want to clear your local cache? This will delete all downloaded emails and AI evaluations.')) {
      try {
        const res = await fetch(`${API_BASE}/emails/clear`, { method: 'POST' });
        if (res.ok) {
          setEmails([]);
          setSelectedEmail(null);
        }
      } catch (err) {
        alert(`Failed to clear database: ${err.message}`);
      }
    }
  };

  const markAllEmailsAsRead = async () => {
    if (emails.length === 0) {
      alert("No emails found on the dashboard to mark as read!");
      return;
    }

    const confirmMsg = `Are you sure you want to mark all ${emails.length} emails currently displayed on your local dashboard as read in your Gmail account?`;
      
    if (confirm(confirmMsg)) {
      setIsMarkingRead(true);
      try {
        const res = await fetch(`${API_BASE}/emails/mark-all-read`, { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          alert(`Success! Marked all ${data.count} dashboard emails as read in your Gmail folder: "${data.folder}".`);
        } else {
          alert(`Error: ${data.error || 'Failed to mark emails as read.'}`);
        }
      } catch (err) {
        alert(`Failed to connect to backend: ${err.message}`);
      } finally {
        setIsMarkingRead(false);
      }
    }
  };

  // Helper to rate color-coded styling
  const getRateClass = (rating) => {
    if (rating >= 9) return { gradient: 'var(--rate-9-10)', name: 'Epic Deal!', class: 'epic' };
    if (rating >= 6) return { gradient: 'var(--rate-6-8)', name: 'Good Deal', class: 'good' };
    if (rating >= 3) return { gradient: 'var(--rate-3-5)', name: 'Weak Offer', class: 'weak' };
    return { gradient: 'var(--rate-0-2)', name: 'Newsletter', class: 'newsletter' };
  };

  // Copy code utility
  const copyToClipboard = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Formats Dates beautifully
  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Compute live statistics for widgets
  const totalAnalyzed = emails.length;
  const averageRating = totalAnalyzed > 0 
    ? (emails.reduce((sum, e) => sum + (e.analysis?.rating || 0), 0) / totalAnalyzed).toFixed(1)
    : '0.0';
  
  const hotDealsCount = emails.filter(e => (e.analysis?.rating || 0) >= 8).length;
  const freebiesCount = emails.filter(e => {
    const rating = e.analysis?.rating || 0;
    if (rating >= 9) return true;

    const discount = e.analysis?.discount;
    const discountStr = typeof discount === 'string'
      ? discount
      : Array.isArray(discount)
        ? discount.join(', ')
        : discount
          ? String(discount)
          : '';

    if (discountStr.toLowerCase().includes('free')) return true;

    const subjectStr = e.subject || '';
    return subjectStr.toLowerCase().includes('free');
  }).length;

  // Filter & Sort Emails
  const filteredEmails = emails
    .filter(email => {
      const score = email.analysis?.rating ?? 0;
      const matchesRating = score >= minRating;
      
      const term = searchQuery.toLowerCase();
      const matchesSearch = 
        email.subject.toLowerCase().includes(term) ||
        email.fromName.toLowerCase().includes(term) ||
        email.fromAddress.toLowerCase().includes(term) ||
        (email.analysis?.dealSummary || '').toLowerCase().includes(term);

      return matchesRating && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'date-desc') return new Date(b.date) - new Date(a.date);
      if (sortBy === 'date-asc') return new Date(a.date) - new Date(b.date);
      if (sortBy === 'rate-desc') return (b.analysis?.rating || 0) - (a.analysis?.rating || 0);
      if (sortBy === 'rate-asc') return (a.analysis?.rating || 0) - (b.analysis?.rating || 0);
      return 0;
    });

  return (
    <div className="app-container">
      {/* SIDEBAR NAVIGATION */}
      <aside className="sidebar">
        <div className="logo-container">
          <span className="logo-icon">⚡</span>
          <h1 className="logo-text">PromoPulse AI</h1>
        </div>

        <ul className="nav-menu">
          <li 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="nav-icon">📊</span>
            Dashboard
          </li>
          <li 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span className="nav-icon">⚙️</span>
            Settings
          </li>
        </ul>

        {/* Global stats widget in sidebar */}
        <div className="sidebar-stats">
          <h4>SYSTEM STATS</h4>
          <div className="stat-row">
            <span className="stat-label">Total Emails</span>
            <span className="stat-value">{totalAnalyzed}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Avg Deal Rating</span>
            <span className="stat-value text-emerald">{averageRating}/10</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Hot Deals (8+)</span>
            <span className="stat-value text-purple">{hotDealsCount}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Freebies Found</span>
            <span className="stat-value highlight">{freebiesCount}</span>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <>
            <div className="header-row">
              <div className="header-title">
                <h2>Local Email Dashboard</h2>
                <p>Browse promotional deals evaluated in real-time by your local Gemma 4 AI.</p>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                  className="btn" 
                  onClick={markAllEmailsAsRead}
                  disabled={isMarkingRead}
                >
                  {isMarkingRead ? '⏳ Marking...' : '✔️ Read All'}
                </button>
                {emails.length > 0 && (
                  <button className="btn" onClick={clearAllCachedData}>
                    🗑️ Clear Cache
                  </button>
                )}
                <button className="btn btn-primary" onClick={triggerEmailFetch}>
                  📥 Scan & Rate Emails
                </button>
              </div>
            </div>

            {/* Dashboard widgets */}
            <section className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon-box cyan">📧</div>
                <div className="stat-info">
                  <p>Analyzed</p>
                  <h3>{totalAnalyzed}</h3>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon-box emerald">⭐</div>
                <div className="stat-info">
                  <p>Avg Rating</p>
                  <h3>{averageRating}</h3>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon-box purple">🔥</div>
                <div className="stat-info">
                  <p>Hot Deals</p>
                  <h3>{hotDealsCount}</h3>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon-box amber">🎁</div>
                <div className="stat-info">
                  <p>Freebies</p>
                  <h3>{freebiesCount}</h3>
                </div>
              </div>
            </section>

            {/* Filters panel */}
            <section className="filters-panel">
              <div className="filter-group">
                <label>Search Offers</label>
                <div className="search-input-wrapper">
                  <span className="search-icon">🔍</span>
                  <input 
                    type="text" 
                    className="search-input"
                    placeholder="Search by sender, subject, summary..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="filter-group">
                <label>Min Deal Rating</label>
                <div className="range-slider-container">
                  <input 
                    type="range" 
                    className="range-slider"
                    min="0"
                    max="10"
                    value={minRating}
                    onChange={(e) => setMinRating(Number(e.target.value))}
                  />
                  <span className="range-val">{minRating}</span>
                </div>
              </div>

              <div className="filter-group">
                <label>Sort By</label>
                <select 
                  className="select-input" 
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="date-desc">Newest First</option>
                  <option value="date-asc">Oldest First</option>
                  <option value="rate-desc">Rating: High to Low</option>
                  <option value="rate-asc">Rating: Low to High</option>
                </select>
              </div>

              <div className="filter-group" style={{ justifyContent: 'flex-end', height: '100%' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right', paddingBottom: '0.5rem' }}>
                  Showing <strong>{filteredEmails.length}</strong> of {emails.length}
                </span>
              </div>
            </section>

            {/* Email Grid list */}
            {loading && emails.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem' }}>
                <div className="spinner-halo" style={{ margin: '0 auto 1.5rem' }}></div>
                <p>Loading your local email dashboard...</p>
              </div>
            ) : (
              <section className="email-grid">
                {filteredEmails.length === 0 ? (
                  <div className="no-emails">
                    <div className="no-emails-icon">📭</div>
                    <h3>No Emails Found</h3>
                    <p>{emails.length === 0 ? "You haven't scanned any promotional emails yet. Click 'Scan & Rate Emails' above!" : "Try adjusting your search criteria or rating filter slider."}</p>
                  </div>
                ) : (
                  filteredEmails.map(email => {
                    const rating = email.analysis?.rating ?? 0;
                    const styleMeta = getRateClass(rating);

                    return (
                      <article 
                        key={email.messageId || email.uid} 
                        className="email-card"
                        onClick={() => setSelectedEmail(email)}
                      >
                        <div className="email-card-header">
                          <div className="email-sender-info">
                            <div className="sender-avatar">
                              {email.fromName.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="sender-text">
                              <h4 className="sender-name">{email.fromName}</h4>
                              <span className="email-date">{formatDate(email.date)}</span>
                            </div>
                          </div>
                          <div 
                            className={`rating-badge ${styleMeta.class}`}
                            style={{ background: styleMeta.gradient }}
                            title={styleMeta.name}
                          >
                            {rating}
                          </div>
                        </div>

                        <div className="email-card-body">
                          <h4 className="email-subject">{email.subject}</h4>
                          <p className="email-summary">
                            {email.analysis?.dealSummary || "No AI analysis performed."}
                          </p>
                        </div>

                        <div className="email-card-footer">
                          {email.analysis?.discount && email.analysis?.discount !== 'None' ? (
                            <span className="discount-tag">
                              🏷️ {email.analysis.discount}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Newsletter</span>
                          )}

                          {email.analysis?.couponCodes && email.analysis.couponCodes.length > 0 && (
                            <span className="coupon-pill">
                              🎫 {email.analysis.couponCodes[0]}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </section>
            )}
          </>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="settings-container">
            <div className="header-row">
              <div className="header-title">
                <h2>System Configurations</h2>
                <p>Configure your Gmail IMAP client and local Ollama endpoint connection.</p>
              </div>
            </div>

            <form onSubmit={saveSettings} className="settings-card">
              <h3>📧 Gmail IMAP Integration</h3>
              
              <div className="settings-grid">
                <div className="form-group">
                  <label>Gmail Address</label>
                  <input 
                    type="email" 
                    className="form-input"
                    required
                    placeholder="your-email@gmail.com"
                    value={settings.email}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                  />
                  <span className="form-help">Enter the Google Gmail account address you want to fetch emails from.</span>
                </div>

                <div className="form-group">
                  <label>Google App Password</label>
                  <input 
                    type="text" 
                    className="form-input"
                    placeholder={settings.hasPassword ? "•••••••••••••••• (Saved - enter to overwrite)" : "xxxx xxxx xxxx xxxx"}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                  <span className="form-help">
                    Must use a 16-character <strong>Google App Password</strong>. Do NOT use your main Gmail login password!
                  </span>
                </div>
              </div>

              <div className="settings-grid">
                <div className="form-group">
                  <label>IMAP Host</label>
                  <input 
                    type="text" 
                    className="form-input"
                    value={settings.imapHost}
                    onChange={(e) => setSettings({ ...settings, imapHost: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>IMAP Port</label>
                  <input 
                    type="number" 
                    className="form-input"
                    value={settings.imapPort}
                    onChange={(e) => setSettings({ ...settings, imapPort: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="form-group">
                <span className="form-help text-amber" style={{ padding: '0.5rem 1rem', background: 'rgba(245, 158, 11, 0.08)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                  💡 <strong>How to get a Google App Password:</strong><br />
                  1. Visit your <strong>Google Account Settings</strong> (myaccount.google.com).<br />
                  2. Enable <strong>2-Step Verification</strong> under the Security section.<br />
                  3. Search for <strong>"App Passwords"</strong> in the top search bar.<br />
                  4. Select App: "Other (custom name)", enter "PromoPulse AI", and copy the generated 16-digit code.
                </span>
              </div>

              <div className="test-row">
                <button type="button" className="btn" onClick={testImapConnection}>
                  🔌 Test IMAP Connection
                </button>
                {imapTestStatus.message && (
                  <span className={`test-status ${imapTestStatus.type}`}>
                    {imapTestStatus.type === 'loading' ? '⌛ ' : imapTestStatus.type === 'success' ? '✅ ' : '❌ '}
                    {imapTestStatus.message}
                  </span>
                )}
              </div>
            </form>

            <form onSubmit={saveSettings} className="settings-card">
              <h3>🤖 Local Ollama Settings</h3>
              
              <div className="settings-grid">
                <div className="form-group">
                  <label>Ollama Server Endpoint</label>
                  <input 
                    type="url" 
                    className="form-input"
                    required
                    placeholder="http://localhost:11434"
                    value={settings.ollamaUrl}
                    onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Ollama Model Name</label>
                  <input 
                    type="text" 
                    className="form-input"
                    required
                    placeholder="gemma4"
                    value={settings.ollamaModel}
                    onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
                  />
                  <span className="form-help">Recommended model: <strong>gemma4</strong> or any local LLM downloaded via Ollama.</span>
                </div>
              </div>

              <div className="settings-grid">
                <div className="form-group">
                  <label>Fetch Limit (Max emails per scan)</label>
                  <input 
                    type="number" 
                    className="form-input"
                    min="1"
                    max="100"
                    value={settings.fetchLimit}
                    onChange={(e) => setSettings({ ...settings, fetchLimit: Number(e.target.value) })}
                  />
                  <span className="form-help">Limits the number of emails fetched and parsed in one scan to save processing time.</span>
                </div>
              </div>

              <h4 style={{ marginTop: '1.5rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>📥 Scanning Preferences</h4>
              <div className="settings-grid">
                <div className="form-group">
                  <label>Source Mailbox Folder</label>
                  <select 
                    className="select-input form-input"
                    style={{ width: '100%' }}
                    value={settings.useInbox ? 'inbox' : 'promo'}
                    onChange={(e) => setSettings({ ...settings, useInbox: e.target.value === 'inbox' })}
                  >
                    <option value="promo">Auto-discover Promotions Folder (Gmail default)</option>
                    <option value="inbox">Main Inbox (INBOX)</option>
                  </select>
                  <span className="form-help">Choose whether to scan your auto-detected promotions or your main inbox directly.</span>
                </div>

                <div className="form-group">
                  <label>Email Read State</label>
                  <select 
                    className="select-input form-input"
                    style={{ width: '100%' }}
                    value={settings.fetchOnlyUnread ? 'unread' : 'all'}
                    onChange={(e) => setSettings({ ...settings, fetchOnlyUnread: e.target.value === 'unread' })}
                  >
                    <option value="all">Scan All Emails (Latest first)</option>
                    <option value="unread">Scan Unread Emails Only</option>
                  </select>
                  <span className="form-help">Choose whether to process all emails or restrict scanning only to unread/unseen messages.</span>
                </div>
              </div>

              <div className="test-row">
                <button type="button" className="btn" onClick={testOllamaConnection}>
                  🔌 Test Ollama Connection
                </button>
                {ollamaTestStatus.message && (
                  <span className={`test-status ${ollamaTestStatus.type}`}>
                    {ollamaTestStatus.type === 'loading' ? '⌛ ' : ollamaTestStatus.type === 'success' ? '✅ ' : '⚠️ '}
                    {ollamaTestStatus.message}
                  </span>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="submit" className="btn btn-primary">
                  💾 Save Configuration
                </button>
                {settingsStatus.message && (
                  <span className={`test-status ${settingsStatus.type}`}>
                    {settingsStatus.type === 'loading' ? '⏳ ' : '💾 '}
                    {settingsStatus.message}
                  </span>
                )}
              </div>
            </form>
          </div>
        )}
      </main>

      {/* DETAIL DRAWER / SLIDE OVER VIEW */}
      {selectedEmail && (
        <div className="drawer-backdrop" onClick={() => setSelectedEmail(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-header-info">
                <h2>{selectedEmail.subject}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  From: <strong>{selectedEmail.fromName}</strong> ({selectedEmail.fromAddress}) // {formatDate(selectedEmail.date)}
                </p>
              </div>
              <button className="drawer-close" onClick={() => setSelectedEmail(null)}>✕</button>
            </div>

            <div className="drawer-content">
              {/* Left Panel: AI Review */}
              <div className="ai-analysis-panel">
                <div className="ai-header-badge">
                  <span>🧠 Gemma 4 AI Deal Rating</span>
                </div>

                <div className="large-score-indicator">
                  <div 
                    className="score-circle"
                    style={{ background: getRateClass(selectedEmail.analysis?.rating || 0).gradient }}
                  >
                    <span className="score-num">{selectedEmail.analysis?.rating ?? 0}</span>
                    <span className="score-max">/10</span>
                  </div>
                  <span className="score-label" style={{ color: getRateClass(selectedEmail.analysis?.rating || 0).class === 'epic' ? 'var(--accent-amber)' : 'inherit' }}>
                    {getRateClass(selectedEmail.analysis?.rating || 0).name}
                  </span>
                </div>

                <div className="ai-details-list">
                  <div className="ai-detail-block">
                    <h5>Deal Summary</h5>
                    <p style={{ fontWeight: '600' }}>
                      {selectedEmail.analysis?.dealSummary || "No deal found."}
                    </p>
                  </div>

                  <div className="ai-detail-block">
                    <h5>Discount Value</h5>
                    {selectedEmail.analysis?.discount && selectedEmail.analysis?.discount !== 'None' ? (
                      <span className="discount-pill-large">
                        {selectedEmail.analysis.discount}
                      </span>
                    ) : (
                      <p style={{ color: 'var(--text-muted)' }}>No notable discount extracted.</p>
                    )}
                  </div>

                  <div className="ai-detail-block">
                    <h5>Active Coupon Codes</h5>
                    {selectedEmail.analysis?.couponCodes && selectedEmail.analysis.couponCodes.length > 0 ? (
                      <div className="coupons-list">
                        {selectedEmail.analysis.couponCodes.map((code, idx) => (
                          <div key={idx} className="coupon-badge-large">
                            <span>{code}</span>
                            <button 
                              className="copy-btn" 
                              onClick={() => copyToClipboard(code)}
                            >
                              {copiedCode === code ? 'Copied! ✅' : 'Copy 📋'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No promotional codes found.</p>
                    )}
                  </div>

                  <div className="ai-detail-block">
                    <h5>Expiration Date</h5>
                    <p style={{ fontFamily: 'var(--font-display)', fontWeight: '600', color: selectedEmail.analysis?.expirationDate !== 'Unknown' ? 'var(--accent-coral)' : 'var(--text-muted)' }}>
                      ⏰ {selectedEmail.analysis?.expirationDate || "Unknown"}
                    </p>
                  </div>

                  <div className="ai-detail-block">
                    <h5>AI Decision Explanation</h5>
                    <p style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                      "{selectedEmail.analysis?.explanation || "No explanation provided."}"
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Panel: Original HTML email in a sandboxed frame */}
              <div className="email-content-panel">
                <div className="email-meta-header">
                  <div className="meta-row">
                    <span className="meta-label">Subject</span>
                    <span className="meta-value">{selectedEmail.subject}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Sender</span>
                    <span className="meta-value">{selectedEmail.fromName} &lt;{selectedEmail.fromAddress}&gt;</span>
                  </div>
                </div>

                <div className="email-iframe-container">
                  <iframe 
                    title="Original Email Render"
                    sandbox="allow-popups" 
                    className="email-iframe"
                    srcDoc={selectedEmail.html}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STREAM FETCHING PROGRESS BAR OVERLAY */}
      {fetchProgress.active && (
        <div className="fetch-overlay">
          <div className="fetch-modal">
            <div className="spinner-halo"></div>
            
            <h3 className="fetch-status-text">Scanning Promotional Inbox</h3>
            <p className="fetch-sub-status">
              {fetchProgress.status}
            </p>

            {fetchProgress.total > 0 && (
              <>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }}
                  ></div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '1.5rem' }}>
                  <span className="progress-percent">
                    Evaluating {fetchProgress.current} of {fetchProgress.total}
                  </span>
                  <span className="progress-percent" style={{ color: 'var(--accent-cyan)' }}>
                    {Math.round((fetchProgress.current / fetchProgress.total) * 100)}%
                  </span>
                </div>

                {fetchProgress.subject && (
                  <div style={{ width: '100%', background: 'hsla(223, 20%, 6%, 0.4)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-light)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600' }}>Evaluating Offer:</span><br />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>"{fetchProgress.subject}"</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
