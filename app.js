// =============================================
// PaidCreative CRM - Application Logic
// =============================================

(function () {
  'use strict';

  // ===== Firebase Setup =====
  // Replace these values with your own Firebase project config.
  // 1. Go to https://console.firebase.google.com
  // 2. Create a project (or use an existing one)
  // 3. Go to Project Settings → General → Your apps → Web app
  // 4. Copy the firebaseConfig object and paste it below
  // 5. Go to Firestore Database → Create database → Start in test mode
  const firebaseConfig = {
    apiKey: "AIzaSyDgt1GnnX0Uchtohg4yW_0iqBnSOmw9Er0",
    authDomain: "paidcreativecrm.firebaseapp.com",
    projectId: "paidcreativecrm",
    storageBucket: "paidcreativecrm.firebasestorage.app",
    messagingSenderId: "749896697894",
    appId: "1:749896697894:web:ba294f43d7732b50eb7ee7"
  };

  let db = null;
  const _useFirebase = firebaseConfig.projectId !== "";

  if (_useFirebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }

  // ===== Auth Gate (Google Sign-In) =====
  // Add team member emails here to restrict access
  const ALLOWED_EMAILS = [
    // e.g. 'sam@paidcreative.com',
    // e.g. 'madison@paidcreative.com',
    // Leave empty to allow any Google account
  ];

  // Team members whose Gmail inboxes are checked for "Needs reply"
  const TEAM_EMAILS = ['sam@paidcreative.com', 'madison@paidcreative.com'];

  let _gmailAccessToken = null;
  let _gmailUserEmail = null;
  let _currentUser = null;

  function initAuthGate(onSuccess) {
    const gate = document.getElementById('password-gate');
    const errorEl = document.getElementById('auth-error');

    // Listen for auth state changes
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        // Check whitelist
        if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email.toLowerCase())) {
          errorEl.textContent = 'Access denied. Your email is not authorized.';
          firebase.auth().signOut();
          return;
        }
        _currentUser = user;
        _gmailUserEmail = user.email;
        gate.classList.add('hidden');
        updateUserDisplay(user);
        onSuccess();
      } else {
        _currentUser = null;
        _gmailAccessToken = null;
        _gmailUserEmail = null;
        gate.classList.remove('hidden');
      }
    });

    // Google Sign-In button
    document.getElementById('btn-google-signin').addEventListener('click', function () {
      errorEl.textContent = '';
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
      firebase.auth().signInWithPopup(provider).then(function (result) {
        // Store the Google OAuth access token for Gmail API calls
        if (result.credential) {
          _gmailAccessToken = result.credential.accessToken;
          sessionStorage.setItem('gmail_access_token', _gmailAccessToken);
        }
      }).catch(function (error) {
        errorEl.textContent = error.message || 'Sign-in failed. Please try again.';
      });
    });

    // Sign-out button
    document.getElementById('btn-sign-out').addEventListener('click', function () {
      firebase.auth().signOut();
      sessionStorage.removeItem('gmail_access_token');
      _gmailAccessToken = null;
      _gmailUserEmail = null;
      _currentUser = null;
      _emailStatusCache.clear();
      document.getElementById('gmail-user-section').style.display = 'none';
    });

    // Restore token from session if still valid
    var savedToken = sessionStorage.getItem('gmail_access_token');
    if (savedToken) {
      _gmailAccessToken = savedToken;
    }
  }

  function updateUserDisplay(user) {
    var section = document.getElementById('gmail-user-section');
    section.style.display = '';
    document.getElementById('gmail-user-name').textContent = user.displayName || '';
    document.getElementById('gmail-user-email').textContent = user.email || '';
    var avatar = document.getElementById('gmail-user-avatar');
    if (user.photoURL) {
      avatar.src = user.photoURL;
      avatar.style.display = '';
    } else {
      avatar.style.display = 'none';
    }
    // Show refresh button when signed in
    var refreshBtn = document.getElementById('btn-refresh-emails');
    if (refreshBtn) refreshBtn.style.display = '';

    // Profile dropdown toggle
    avatar.addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('user-profile-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', function () {
      document.getElementById('user-profile-dropdown').classList.remove('open');
    });

    // Refresh email statuses button
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        if (refreshBtn.classList.contains('spinning')) return;
        refreshBtn.classList.add('spinning');
        // Re-acquire Gmail token if missing or expired
        if (!_gmailAccessToken) {
          await refreshGmailToken();
        }
        var minSpin = new Promise(function (r) { setTimeout(r, 800); });
        await Promise.all([checkAllEmailStatuses(), minSpin]).finally(function () {
          refreshBtn.classList.remove('spinning');
        });
      });
    }
  }

  // ===== Gmail API Helpers =====
  async function refreshGmailToken() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    try {
      var result = await firebase.auth().signInWithPopup(provider);
      if (result.credential) {
        _gmailAccessToken = result.credential.accessToken;
        sessionStorage.setItem('gmail_access_token', _gmailAccessToken);
        return true;
      }
    } catch (e) {
      console.warn('Gmail re-auth failed:', e.message);
    }
    return false;
  }

  async function gmailFetch(url) {
    if (!_gmailAccessToken) return null;
    var resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + _gmailAccessToken }
    });
    if (resp.status === 401) {
      // Token expired — need re-auth
      _gmailAccessToken = null;
      sessionStorage.removeItem('gmail_access_token');
      return null;
    }
    if (!resp.ok) return null;
    return resp.json();
  }

  async function fetchThreadsForContact(email) {
    if (!email || !_gmailAccessToken) return [];
    var q = encodeURIComponent('from:' + email + ' OR to:' + email);
    var data = await gmailFetch('https://www.googleapis.com/gmail/v1/users/me/threads?q=' + q + '&maxResults=10');
    if (!data || !data.threads) return [];
    return data.threads;
  }

  async function fetchThreadDetail(threadId) {
    return gmailFetch('https://www.googleapis.com/gmail/v1/users/me/threads/' + threadId + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date');
  }

  async function fetchFullMessage(messageId) {
    return gmailFetch('https://www.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?format=full');
  }

  function getHeader(message, name) {
    if (!message || !message.payload || !message.payload.headers) return '';
    var header = message.payload.headers.find(function (h) { return h.name.toLowerCase() === name.toLowerCase(); });
    return header ? header.value : '';
  }

  function extractEmail(fromHeader) {
    var match = fromHeader.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
  }

  function decodeBase64Url(str) {
    if (!str) return '';
    var base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    try {
      return decodeURIComponent(escape(atob(base64)));
    } catch (e) {
      try { return atob(base64); } catch (e2) { return ''; }
    }
  }

  function getMessageBody(message) {
    if (!message || !message.payload) return '';
    // Check for simple body
    if (message.payload.body && message.payload.body.data) {
      return decodeBase64Url(message.payload.body.data);
    }
    // Check parts for text/plain or text/html
    var parts = message.payload.parts || [];
    var plainPart = parts.find(function (p) { return p.mimeType === 'text/plain'; });
    if (plainPart && plainPart.body && plainPart.body.data) {
      return decodeBase64Url(plainPart.body.data);
    }
    var htmlPart = parts.find(function (p) { return p.mimeType === 'text/html'; });
    if (htmlPart && htmlPart.body && htmlPart.body.data) {
      var html = decodeBase64Url(htmlPart.body.data);
      // Strip HTML tags for display
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || '';
    }
    return '';
  }

  // ===== Email Status Monitoring =====
  var _emailStatusCache = new Map();
  var _emailMonitorInterval = null;

  async function checkEmailStatusForContact(contactEmail) {
    if (!contactEmail || !_gmailAccessToken) return null;
    var email = contactEmail.toLowerCase().trim();
    var threads = await fetchThreadsForContact(email);
    var result;
    if (!threads || threads.length === 0) {
      result = { unanswered: false, noThreads: true, snippet: '' };
    } else {
      var thread = await fetchThreadDetail(threads[0].id);
      if (!thread || !thread.messages || thread.messages.length === 0) {
        result = { unanswered: false, noThreads: true, snippet: '' };
      } else {
        var lastMsg = thread.messages[thread.messages.length - 1];
        var fromEmail = extractEmail(getHeader(lastMsg, 'From'));
        var isFromContact = fromEmail === email;
        var isFromTeam = TEAM_EMAILS.some(function(te) { return te.toLowerCase() === fromEmail; });
        var unanswered = isFromContact && !isFromTeam;
        result = { unanswered: unanswered, snippet: threads[0].snippet || '', noThreads: false };
      }
    }
    _emailStatusCache.set(email, result);
    return result;
  }

  async function checkAllEmailStatuses() {
    if (!_gmailAccessToken) return;
    var deals = Store.getDeals();
    var contacts = Store.getContacts();
    var activeStages = STAGES.filter(function (s) { return s !== 'closed_won' && s !== 'closed_lost'; });
    var activeDeals = deals.filter(function (d) { return activeStages.includes(d.stage); });

    var checkedEmails = {};
    for (var i = 0; i < activeDeals.length; i++) {
      var deal = activeDeals[i];
      var cids = getDealContactIds(deal);
      for (var j = 0; j < cids.length; j++) {
        var contact = contacts.find(function (c) { return c.id === cids[j]; });
        if (!contact || !contact.email) continue;
        if (checkedEmails[contact.email]) continue;
        checkedEmails[contact.email] = true;
        await checkEmailStatusForContact(contact.email);
        await new Promise(function (r) { setTimeout(r, 100); });
      }
    }
    renderPipeline();
  }

  function startEmailMonitor() {
    if (_emailMonitorInterval) clearInterval(_emailMonitorInterval);
    // Check immediately
    checkAllEmailStatuses();
    // Then every 15 minutes
    _emailMonitorInterval = setInterval(checkAllEmailStatuses, 15 * 60 * 1000);
  }

  function getEmailStatusForContact(contactEmail) {
    if (!contactEmail) return null;
    return _emailStatusCache.get(contactEmail.toLowerCase().trim()) || null;
  }

  // ===== Constants =====
  const DEFAULT_MRR_GOAL = 83000;

  // Local cache (populated from Firestore or localStorage)
  let _cache = {
    deals: JSON.parse(localStorage.getItem('crm_deals') || '[]'),
    contacts: JSON.parse(localStorage.getItem('crm_contacts') || '[]'),
    activities: JSON.parse(localStorage.getItem('crm_activities') || '[]'),
    mrrHistory: JSON.parse(localStorage.getItem('crm_mrr_history') || '[]'),
    mrrGoal: parseFloat(localStorage.getItem('crm_mrr_goal')) || DEFAULT_MRR_GOAL,
    stageLabels: JSON.parse(localStorage.getItem('crm_stage_labels') || '{}')
  };

  function getMrrGoal() {
    return _cache.mrrGoal;
  }

  function setMrrGoal(val) {
    _cache.mrrGoal = val;
    localStorage.setItem('crm_mrr_goal', val.toString());
    if (_useFirebase) {
      db.collection('crm').doc('settings').set(
        { mrrGoal: val },
        { merge: true }
      );
    }
  }

  function getStageLabel(stage) {
    return _cache.stageLabels[stage] || STAGE_LABELS[stage] || stage;
  }

  function setStageLabel(stage, label) {
    _cache.stageLabels[stage] = label;
    localStorage.setItem('crm_stage_labels', JSON.stringify(_cache.stageLabels));
    if (_useFirebase) {
      db.collection('crm').doc('settings').set(
        { stageLabels: _cache.stageLabels },
        { merge: true }
      );
    }
  }

  const STAGES = ['discovery', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
  const STAGE_LABELS = {
    discovery: 'Discovery',
    qualification: 'Qualification',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
    closed_won: 'Closed Won',
    closed_lost: 'Lost/Inactive'
  };
  const STAGE_COLORS = {
    discovery: '#6366f1',
    qualification: '#8b5cf6',
    proposal: '#ec4899',
    negotiation: '#f59e0b',
    closed_won: '#10b981',
    closed_lost: '#ef4444'
  };
  const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];

  // ===== Data Store =====
  const Store = {
    getDeals() {
      return _cache.deals;
    },
    saveDeals(deals) {
      _cache.deals = deals;
      localStorage.setItem('crm_deals', JSON.stringify(deals));
      if (_useFirebase) {
        db.collection('crm').doc('deals').set({ items: deals });
      }
    },
    getContacts() {
      return _cache.contacts;
    },
    saveContacts(contacts) {
      _cache.contacts = contacts;
      localStorage.setItem('crm_contacts', JSON.stringify(contacts));
      if (_useFirebase) {
        db.collection('crm').doc('contacts').set({ items: contacts });
      }
    },
    getActivities() {
      return _cache.activities;
    },
    saveActivities(activities) {
      _cache.activities = activities;
      localStorage.setItem('crm_activities', JSON.stringify(activities));
      if (_useFirebase) {
        db.collection('crm').doc('activities').set({ items: activities });
      }
    },
    addActivity(text, color) {
      const activities = this.getActivities();
      activities.unshift({
        text,
        color: color || '#6366f1',
        time: new Date().toISOString()
      });
      // Keep last 50 activities
      if (activities.length > 50) activities.length = 50;
      this.saveActivities(activities);
    },
    getMrrHistory() {
      return _cache.mrrHistory;
    },
    saveMrrHistory(history) {
      _cache.mrrHistory = history;
      localStorage.setItem('crm_mrr_history', JSON.stringify(history));
      if (_useFirebase) {
        db.collection('crm').doc('settings').set(
          { mrrHistory: history },
          { merge: true }
        );
      }
    },
    updateMrrHistory() {
      const history = this.getMrrHistory();
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const currentMrr = this.calculateMRR();

      const existingIdx = history.findIndex(h => h.month === monthKey);
      if (existingIdx >= 0) {
        history[existingIdx].value = currentMrr;
      } else {
        history.push({ month: monthKey, value: currentMrr });
      }

      // Keep last 12 months
      if (history.length > 12) history.splice(0, history.length - 12);
      this.saveMrrHistory(history);
    },
    calculateMRR() {
      const deals = this.getDeals();
      return deals
        .filter(d => d.stage === 'closed_won' && d.type !== 'one_time')
        .reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
    }
  };

  // ===== Firestore Real-Time Listeners =====
  function initFirebaseListeners() {
    if (!_useFirebase) return;

    // Suppress re-renders triggered by our own writes
    let _localWriteInProgress = false;
    const originalSaveDeals = Store.saveDeals.bind(Store);
    const originalSaveContacts = Store.saveContacts.bind(Store);
    const originalSaveActivities = Store.saveActivities.bind(Store);
    const originalSaveMrrHistory = Store.saveMrrHistory.bind(Store);

    Store.saveDeals = function (deals) {
      _localWriteInProgress = true;
      originalSaveDeals(deals);
      setTimeout(() => { _localWriteInProgress = false; }, 500);
    };
    Store.saveContacts = function (contacts) {
      _localWriteInProgress = true;
      originalSaveContacts(contacts);
      setTimeout(() => { _localWriteInProgress = false; }, 500);
    };
    Store.saveActivities = function (activities) {
      _localWriteInProgress = true;
      originalSaveActivities(activities);
      setTimeout(() => { _localWriteInProgress = false; }, 500);
    };
    Store.saveMrrHistory = function (history) {
      _localWriteInProgress = true;
      originalSaveMrrHistory(history);
      setTimeout(() => { _localWriteInProgress = false; }, 500);
    };

    db.collection('crm').doc('deals').onSnapshot(doc => {
      if (_localWriteInProgress) return;
      const data = doc.data();
      if (data && data.items) {
        _cache.deals = data.items;
        localStorage.setItem('crm_deals', JSON.stringify(data.items));
        renderPipeline();
      }
    });

    db.collection('crm').doc('contacts').onSnapshot(doc => {
      if (_localWriteInProgress) return;
      const data = doc.data();
      if (data && data.items) {
        _cache.contacts = data.items;
        localStorage.setItem('crm_contacts', JSON.stringify(data.items));
        renderContacts();
        renderPipeline();
      }
    });

    db.collection('crm').doc('activities').onSnapshot(doc => {
      if (_localWriteInProgress) return;
      const data = doc.data();
      if (data && data.items) {
        _cache.activities = data.items;
        localStorage.setItem('crm_activities', JSON.stringify(data.items));
      }
    });

    db.collection('crm').doc('settings').onSnapshot(doc => {
      if (_localWriteInProgress) return;
      const data = doc.data();
      if (data) {
        if (data.mrrHistory) {
          _cache.mrrHistory = data.mrrHistory;
          localStorage.setItem('crm_mrr_history', JSON.stringify(data.mrrHistory));
        }
        if (data.mrrGoal != null) {
          _cache.mrrGoal = data.mrrGoal;
          localStorage.setItem('crm_mrr_goal', data.mrrGoal.toString());
          updateMrrDisplay();
        }
        if (data.stageLabels) {
          _cache.stageLabels = data.stageLabels;
          localStorage.setItem('crm_stage_labels', JSON.stringify(data.stageLabels));
          renderPipeline();
        }
      }
    });

  }

  // Load initial data from Firestore (first load seeds cache)
  // If Firestore is empty but localStorage has data, migrate it up automatically.
  function loadInitialData() {
    if (!_useFirebase) return Promise.resolve();

    return db.collection('crm').get().then(snapshot => {
      const firestoreDocs = {};
      snapshot.forEach(doc => {
        firestoreDocs[doc.id] = doc.data();
      });

      // Check if Firestore has any deal/contact data yet
      const firestoreHasData = (firestoreDocs.deals && firestoreDocs.deals.items && firestoreDocs.deals.items.length > 0) ||
        (firestoreDocs.contacts && firestoreDocs.contacts.items && firestoreDocs.contacts.items.length > 0);

      if (firestoreHasData) {
        // Firestore has data — use it as the source of truth
        if (firestoreDocs.deals && firestoreDocs.deals.items) {
          _cache.deals = firestoreDocs.deals.items;
          localStorage.setItem('crm_deals', JSON.stringify(firestoreDocs.deals.items));
        }
        if (firestoreDocs.contacts && firestoreDocs.contacts.items) {
          _cache.contacts = firestoreDocs.contacts.items;
          localStorage.setItem('crm_contacts', JSON.stringify(firestoreDocs.contacts.items));
        }
        if (firestoreDocs.activities && firestoreDocs.activities.items) {
          _cache.activities = firestoreDocs.activities.items;
          localStorage.setItem('crm_activities', JSON.stringify(firestoreDocs.activities.items));
        }
        if (firestoreDocs.settings) {
          if (firestoreDocs.settings.mrrHistory) {
            _cache.mrrHistory = firestoreDocs.settings.mrrHistory;
            localStorage.setItem('crm_mrr_history', JSON.stringify(firestoreDocs.settings.mrrHistory));
          }
          if (firestoreDocs.settings.mrrGoal != null) {
            _cache.mrrGoal = firestoreDocs.settings.mrrGoal;
            localStorage.setItem('crm_mrr_goal', firestoreDocs.settings.mrrGoal.toString());
          }
          if (firestoreDocs.settings.stageLabels) {
            _cache.stageLabels = firestoreDocs.settings.stageLabels;
            localStorage.setItem('crm_stage_labels', JSON.stringify(firestoreDocs.settings.stageLabels));
          }
        }
      } else if (_cache.deals.length > 0 || _cache.contacts.length > 0) {
        // Firestore is empty but localStorage has data — migrate it up
        console.log('Migrating existing localStorage data to Firestore...');
        const batch = db.batch();
        batch.set(db.collection('crm').doc('deals'), { items: _cache.deals });
        batch.set(db.collection('crm').doc('contacts'), { items: _cache.contacts });
        batch.set(db.collection('crm').doc('activities'), { items: _cache.activities });
        batch.set(db.collection('crm').doc('settings'), {
          mrrGoal: _cache.mrrGoal,
          mrrHistory: _cache.mrrHistory,
          stageLabels: _cache.stageLabels
        });
        return batch.commit().then(() => {
          console.log('Migration complete — all data is now in Firestore.');
        });
      }
    });
  }

  // ===== Utility Functions =====
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  function formatCurrency(amount) {
    return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function getInitials(firstName, lastName) {
    return ((firstName || '')[0] || '') + ((lastName || '')[0] || '');
  }

  function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function timeAgo(isoString) {
    const now = new Date();
    const then = new Date(isoString);
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return then.toLocaleDateString();
  }

  function formatDate(isoString) {
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ===== Navigation =====
  function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        switchView(view);
      });
    });
  }

  function switchView(viewName) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
    document.getElementById(`view-${viewName}`).classList.add('active');

    if (viewName === 'contacts') renderContacts();
    if (viewName === 'pipeline') renderPipeline();
  }

  // ===== Contact Helpers =====
  // Backward-compatible helper: returns array of contact IDs for a deal
  function getDealContactIds(deal) {
    if (deal.contactIds && deal.contactIds.length > 0) return deal.contactIds;
    if (deal.contactId) return [deal.contactId];
    return [];
  }

  // ===== Pipeline =====
  function renderPipeline() {
    const deals = Store.getDeals();

    STAGES.forEach(stage => {
      const col = document.querySelector(`.pipeline-column[data-stage="${stage}"]`);
      const h3 = col.querySelector('.column-header h3');
      h3.textContent = getStageLabel(stage);
      const body = document.querySelector(`.column-body[data-stage="${stage}"]`);
      const countEl = document.querySelector(`[data-count="${stage}"]`);
      const stageDeals = deals.filter(d => d.stage === stage)
        .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));

      countEl.textContent = stageDeals.length;
      const totalEl = document.querySelector(`[data-total="${stage}"]`);
      const recurringTotal = stageDeals.filter(d => d.type !== 'one_time').reduce((sum, d) => sum + (d.value || 0), 0);
      const oneTimeTotal = stageDeals.filter(d => d.type === 'one_time').reduce((sum, d) => sum + (d.value || 0), 0);
      if (recurringTotal > 0 && oneTimeTotal > 0) {
        totalEl.textContent = formatCurrency(recurringTotal) + '/mo + ' + formatCurrency(oneTimeTotal) + ' one-time';
      } else if (oneTimeTotal > 0) {
        totalEl.textContent = formatCurrency(oneTimeTotal) + ' one-time';
      } else {
        totalEl.textContent = formatCurrency(recurringTotal) + '/mo';
      }
      body.innerHTML = '';

      stageDeals.forEach(deal => {
        const contacts = Store.getContacts();
        const dealContactIds = getDealContactIds(deal);
        const dealContacts = dealContactIds.map(cid => contacts.find(c => c.id === cid)).filter(Boolean);
        const companyText = dealContacts.map(c => c.company || `${c.firstName} ${c.lastName}`).join(', ');

        const isOneTime = deal.type === 'one_time';
        const valueLabel = isOneTime ? formatCurrency(deal.value) : formatCurrency(deal.value) + '/mo';
        const typeBadge = isOneTime ? '<span class="deal-type-badge one-time">One-Time</span>' : '';
        const ownerClass = deal.owner === 'Madison' ? ' madison' : '';
        const ownerHtml = deal.owner
          ? `<span class="deal-card-owner${ownerClass}" title="${escapeHtml(deal.owner)}">${escapeHtml(deal.owner[0])}</span>`
          : '';

        // Follow-up date border logic
        let followUpClass = '';
        if (deal.followUpDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const followUp = new Date(deal.followUpDate + 'T00:00:00');
          if (followUp.getTime() === today.getTime()) {
            followUpClass = ' follow-up-today';
          } else if (followUp < today) {
            followUpClass = ' follow-up-overdue';
          } else {
            followUpClass = ' follow-up-upcoming';
          }
        }

        let followUpHtml = '';
        if (deal.followUpDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const fuDate = new Date(deal.followUpDate + 'T00:00:00');
          const diffDays = Math.round((fuDate - today) / (1000 * 60 * 60 * 24));
          let daysText;
          if (diffDays === 0) daysText = 'Today';
          else if (diffDays === 1) daysText = '1 day';
          else if (diffDays > 1) daysText = `${diffDays} days`;
          else if (diffDays === -1) daysText = '1 day ago';
          else daysText = `${Math.abs(diffDays)} days ago`;
          const cls = followUpClass ? (followUpClass.includes('overdue') ? ' overdue' : ' today') : '';
          followUpHtml = `<div class="deal-card-follow-up${cls}">Follow up: ${formatDate(deal.followUpDate + 'T00:00:00')} | ${daysText}</div>`;
        }

        const card = document.createElement('div');
        card.className = 'deal-card' + followUpClass;
        card.draggable = true;
        card.dataset.dealId = deal.id;
        // Email status badge — show if any contact needs reply
        let emailBadgeHtml = '';
        const needsReply = dealContacts.some(c => {
          if (!c.email) return false;
          const emailStatus = getEmailStatusForContact(c.email);
          return emailStatus && emailStatus.unanswered;
        });
        if (needsReply) {
          emailBadgeHtml = `<div class="deal-card-email-badge unanswered"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Needs reply</div>`;
        }

        card.innerHTML = `
          <div class="deal-card-top"><div class="deal-card-name">${escapeHtml(deal.name)}</div>${ownerHtml}</div>
          ${companyText ? `<div class="deal-card-company">${escapeHtml(companyText)}</div>` : ''}
          <div class="deal-card-footer">
            <span class="deal-card-value${isOneTime ? ' one-time' : ''}">${valueLabel}</span>${typeBadge}
          </div>
          ${followUpHtml}
          ${emailBadgeHtml}
        `;

        card.addEventListener('click', () => openDealModal(deal.id));
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        body.appendChild(card);
      });
    });

    updateMrrDisplay();
    renderPipelineSummary();
  }

  function renderPipelineSummary() {
    const deals = Store.getDeals();
    const activeStages = STAGES.filter(s => s !== 'closed_won' && s !== 'closed_lost');
    const activeDeals = deals.filter(d => activeStages.includes(d.stage));
    const recurringPipeline = activeDeals.filter(d => d.type !== 'one_time').reduce((sum, d) => sum + (d.value || 0), 0);
    const oneTimePipeline = activeDeals.filter(d => d.type === 'one_time').reduce((sum, d) => sum + (d.value || 0), 0);
    const wonOneTime = deals.filter(d => d.stage === 'closed_won' && d.type === 'one_time').reduce((sum, d) => sum + (d.value || 0), 0);

    const el = document.getElementById('pipeline-summary');
    const parts = [];
    if (recurringPipeline > 0) parts.push(`<span class="summary-item"><span class="summary-label">Recurring Pipeline</span><span class="summary-value">${formatCurrency(recurringPipeline)}/mo</span></span>`);
    if (oneTimePipeline > 0) parts.push(`<span class="summary-item"><span class="summary-label">One-Time Pipeline</span><span class="summary-value one-time">${formatCurrency(oneTimePipeline)}</span></span>`);
    if (wonOneTime > 0) parts.push(`<span class="summary-item"><span class="summary-label">One-Time Won</span><span class="summary-value won">${formatCurrency(wonOneTime)}</span></span>`);

    el.innerHTML = parts.join('<span class="summary-divider"></span>');
    el.style.display = parts.length > 0 ? '' : 'none';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Drag & Drop =====
  let draggedDealId = null;

  function handleDragStart(e) {
    draggedDealId = e.target.dataset.dealId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.column-body').forEach(col => col.classList.remove('drag-over'));
    document.querySelectorAll('.deal-card').forEach(c => c.classList.remove('drag-insert-before', 'drag-insert-after'));
  }

  function getDragAfterElement(column, y) {
    const cards = [...column.querySelectorAll('.deal-card:not(.dragging)')];
    return cards.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: -Infinity }).element;
  }

  function clearDropIndicators() {
    document.querySelectorAll('.deal-card').forEach(c => c.classList.remove('drag-insert-before', 'drag-insert-after'));
  }

  function initDragDrop() {
    document.querySelectorAll('.column-body').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');

        clearDropIndicators();
        const afterElement = getDragAfterElement(col, e.clientY);
        if (afterElement) {
          afterElement.classList.add('drag-insert-before');
        } else {
          const cards = [...col.querySelectorAll('.deal-card:not(.dragging)')];
          if (cards.length > 0) {
            cards[cards.length - 1].classList.add('drag-insert-after');
          }
        }
      });

      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) {
          col.classList.remove('drag-over');
          clearDropIndicators();
        }
      });

      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        clearDropIndicators();
        if (!draggedDealId) return;

        const newStage = col.dataset.stage;
        const deals = Store.getDeals();
        const deal = deals.find(d => d.id === draggedDealId);
        if (!deal) { draggedDealId = null; return; }

        const oldStage = deal.stage;
        const stageChanged = deal.stage !== newStage;
        deal.stage = newStage;
        deal.updatedAt = new Date().toISOString();

        // Determine insertion index based on drop position
        const afterElement = getDragAfterElement(col, e.clientY);
        const sameStageDeals = deals
          .filter(d => d.stage === newStage && d.id !== deal.id)
          .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));

        let insertIndex;
        if (afterElement) {
          insertIndex = sameStageDeals.findIndex(d => d.id === afterElement.dataset.dealId);
          if (insertIndex === -1) insertIndex = sameStageDeals.length;
        } else {
          insertIndex = sameStageDeals.length;
        }

        // Insert deal at the right position and reassign sortOrder
        sameStageDeals.splice(insertIndex, 0, deal);
        sameStageDeals.forEach((d, i) => { d.sortOrder = i; });

        // Reorder the old column too if stage changed
        if (stageChanged) {
          deals.filter(d => d.stage === oldStage)
            .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity))
            .forEach((d, i) => { d.sortOrder = i; });
        }

        Store.saveDeals(deals);

        if (stageChanged) {
          Store.addActivity(
            `<strong>${deal.name}</strong> moved from ${getStageLabel(oldStage)} to ${getStageLabel(newStage)}`,
            STAGE_COLORS[newStage]
          );
          Store.updateMrrHistory();
        }

        renderPipeline();
        draggedDealId = null;
      });
    });
  }

  // ===== Deal Modal =====
  function resetDealNewContactFields() {
    _editingContactId = null;
    const fields = document.getElementById('deal-new-contact-fields');
    fields.style.display = 'none';
    document.getElementById('deal-contact-first').value = '';
    document.getElementById('deal-contact-last').value = '';
    document.getElementById('deal-contact-email').value = '';
    document.getElementById('deal-contact-company').value = '';
    document.getElementById('deal-contact-phone').value = '';
    document.getElementById('deal-contact-title').value = '';
    document.getElementById('deal-contact-notes').value = '';
    document.getElementById('deal-contact-first').removeAttribute('required');
    document.getElementById('deal-contact-last').removeAttribute('required');
    const toggleBtn = document.getElementById('deal-new-contact-toggle');
    toggleBtn.textContent = '+ New';
    toggleBtn.style.display = '';
    const editBtn = document.getElementById('deal-edit-contact-btn');
    editBtn.textContent = 'Edit';
    updateEditContactBtnVisibility();
    document.getElementById('deal-contact').disabled = false;
  }

  function updateEditContactBtnVisibility() {
    const contactSelect = document.getElementById('deal-contact');
    const editBtn = document.getElementById('deal-edit-contact-btn');
    const fields = document.getElementById('deal-new-contact-fields');
    const isFieldsOpen = fields.style.display !== 'none';
    editBtn.style.display = (contactSelect.value && !isFieldsOpen) ? '' : 'none';
  }

  function toggleDealNewContact() {
    const fields = document.getElementById('deal-new-contact-fields');
    const contactSelect = document.getElementById('deal-contact');
    const toggleBtn = document.getElementById('deal-new-contact-toggle');
    const isShowing = fields.style.display !== 'none';

    if (isShowing) {
      // Collapse: switch back to dropdown
      resetDealNewContactFields();
    } else {
      // Expand: show inline fields, disable dropdown
      _editingContactId = null;
      fields.style.display = '';
      contactSelect.value = '';
      contactSelect.disabled = true;
      toggleBtn.textContent = 'Cancel';
      document.getElementById('deal-edit-contact-btn').style.display = 'none';
      document.getElementById('deal-contact-first').setAttribute('required', '');
      document.getElementById('deal-contact-last').setAttribute('required', '');
    }
  }

  function toggleDealEditContact() {
    const fields = document.getElementById('deal-new-contact-fields');
    const contactSelect = document.getElementById('deal-contact');
    const editBtn = document.getElementById('deal-edit-contact-btn');
    const isShowing = fields.style.display !== 'none';

    if (isShowing) {
      resetDealNewContactFields();
      return;
    }

    const contactId = contactSelect.value;
    if (!contactId) return;
    const contacts = Store.getContacts();
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    _editingContactId = contactId;
    fields.style.display = '';
    contactSelect.disabled = true;
    editBtn.textContent = 'Cancel';
    document.getElementById('deal-new-contact-toggle').style.display = 'none';
    document.getElementById('deal-contact-first').value = contact.firstName || '';
    document.getElementById('deal-contact-last').value = contact.lastName || '';
    document.getElementById('deal-contact-email').value = contact.email || '';
    document.getElementById('deal-contact-company').value = contact.company || '';
    document.getElementById('deal-contact-phone').value = contact.phone || '';
    document.getElementById('deal-contact-title').value = contact.title || '';
    document.getElementById('deal-contact-notes').value = contact.notes || '';
    document.getElementById('deal-contact-first').setAttribute('required', '');
    document.getElementById('deal-contact-last').setAttribute('required', '');
  }

  // ===== Deal Contacts (multi-contact support) =====
  let _modalContactIds = [];

  function renderDealContactChips() {
    const container = document.getElementById('deal-contact-chips');
    const contacts = Store.getContacts();
    container.innerHTML = _modalContactIds.map(cid => {
      const c = contacts.find(x => x.id === cid);
      if (!c) return '';
      const label = (c.firstName + ' ' + c.lastName).trim() + (c.company ? ' (' + c.company + ')' : '');
      return `<span class="deal-contact-chip" data-contact-id="${cid}">
        <span class="chip-name">${escapeHtml(label)}</span>
        <button type="button" class="chip-edit" title="Edit contact">&hellip;</button>
        <button type="button" class="chip-remove" title="Remove">&times;</button>
      </span>`;
    }).join('');

    container.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', function () {
        const chip = this.closest('.deal-contact-chip');
        const cid = chip.dataset.contactId;
        _modalContactIds = _modalContactIds.filter(id => id !== cid);
        renderDealContactChips();
      });
    });
    container.querySelectorAll('.chip-edit').forEach(btn => {
      btn.addEventListener('click', function () {
        const chip = this.closest('.deal-contact-chip');
        const cid = chip.dataset.contactId;
        // Set the dropdown to this contact and trigger edit
        document.getElementById('deal-contact-picker').style.display = '';
        document.getElementById('deal-contact').value = cid;
        updateEditContactBtnVisibility();
        toggleDealEditContact();
      });
    });
  }

  function showContactPicker() {
    const picker = document.getElementById('deal-contact-picker');
    picker.style.display = '';
    document.getElementById('deal-contact').value = '';
    updateEditContactBtnVisibility();
  }

  function addContactFromPicker() {
    const select = document.getElementById('deal-contact');
    const cid = select.value;
    if (!cid || _modalContactIds.includes(cid)) return;
    _modalContactIds.push(cid);
    renderDealContactChips();
    // Reset picker
    select.value = '';
    document.getElementById('deal-contact-picker').style.display = 'none';
    resetDealNewContactFields();
  }

  // ===== Deal Comments =====
  let _modalComments = [];
  let _editingContactId = null;

  function renderDealComments() {
    const list = document.getElementById('deal-comments-list');
    if (_modalComments.length === 0) {
      list.innerHTML = '<div class="deal-comments-empty">No comments yet</div>';
      return;
    }
    list.innerHTML = _modalComments.map((c, i) => `
      <div class="deal-comment" data-idx="${i}">
        <div class="deal-comment-header">
          <span class="deal-comment-date">${formatDate(c.date)}${c.editedAt ? ' (edited)' : ''}</span>
          <div class="deal-comment-actions">
            <button type="button" class="deal-comment-edit" data-idx="${i}" title="Edit comment">&#9998;</button>
            <button type="button" class="deal-comment-delete" data-idx="${i}" title="Delete comment">&times;</button>
          </div>
        </div>
        <div class="deal-comment-text">${escapeHtml(c.text)}</div>
      </div>
    `).join('');

    list.querySelectorAll('.deal-comment-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.idx, 10);
        _modalComments.splice(idx, 1);
        renderDealComments();
        saveDealComments();
      });
    });

    list.querySelectorAll('.deal-comment-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.idx, 10);
        startEditComment(idx);
      });
    });
  }

  function startEditComment(idx) {
    const comment = _modalComments[idx];
    const commentEl = document.querySelector(`.deal-comment[data-idx="${idx}"]`);
    if (!commentEl) return;

    const textEl = commentEl.querySelector('.deal-comment-text');
    const actionsEl = commentEl.querySelector('.deal-comment-actions');
    actionsEl.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'deal-comment-edit-input';
    textarea.value = comment.text;
    textarea.rows = 2;

    const btnWrap = document.createElement('div');
    btnWrap.className = 'deal-comment-edit-btns';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';

    btnWrap.appendChild(saveBtn);
    btnWrap.appendChild(cancelBtn);

    textEl.style.display = 'none';
    commentEl.appendChild(textarea);
    commentEl.appendChild(btnWrap);
    textarea.focus();

    saveBtn.addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (newText && newText !== comment.text) {
        _modalComments[idx].text = newText;
        _modalComments[idx].editedAt = new Date().toISOString();
        saveDealComments();
      }
      renderDealComments();
    });

    cancelBtn.addEventListener('click', () => {
      renderDealComments();
    });

    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        saveBtn.click();
      }
      if (ev.key === 'Escape') {
        cancelBtn.click();
      }
    });
  }

  function addDealComment() {
    const input = document.getElementById('deal-comment-input');
    const text = input.value.trim();
    if (!text) return;

    _modalComments.unshift({
      text,
      date: new Date().toISOString()
    });
    input.value = '';
    renderDealComments();
    saveDealComments();
  }

  function saveDealComments() {
    const id = document.getElementById('deal-id').value;
    if (!id) return;
    const deals = Store.getDeals();
    const deal = deals.find(d => d.id === id);
    if (deal) {
      deal.comments = _modalComments;
      deal.updatedAt = new Date().toISOString();
      Store.saveDeals(deals);
    }
  }

  function getDealComments(deal) {
    // Migrate legacy notes to comments
    if (deal.comments && deal.comments.length > 0) {
      return deal.comments;
    }
    if (deal.notes && deal.notes.trim()) {
      return [{ text: deal.notes.trim(), date: deal.createdAt || new Date().toISOString() }];
    }
    return [];
  }

  function openDealModal(dealId) {
    const modal = document.getElementById('deal-modal');
    const form = document.getElementById('deal-form');
    const titleEl = document.getElementById('deal-modal-title');
    const deleteBtn = document.getElementById('deal-delete');

    // Populate contact dropdown
    const contactSelect = document.getElementById('deal-contact');
    const contacts = Store.getContacts();
    contactSelect.innerHTML = '<option value="">-- Select Contact --</option>';
    contacts.forEach(c => {
      contactSelect.innerHTML += `<option value="${c.id}">${escapeHtml(c.firstName + ' ' + c.lastName)}${c.company ? ' (' + escapeHtml(c.company) + ')' : ''}</option>`;
    });

    // Populate stage dropdown with custom labels
    const stageSelect = document.getElementById('deal-stage');
    stageSelect.innerHTML = STAGES.map(s =>
      `<option value="${s}">${escapeHtml(getStageLabel(s))}</option>`
    ).join('');

    // Reset inline new-contact fields
    resetDealNewContactFields();

    // Reset comment input
    document.getElementById('deal-comment-input').value = '';

    if (dealId) {
      const deals = Store.getDeals();
      const deal = deals.find(d => d.id === dealId);
      if (!deal) return;

      titleEl.textContent = 'Edit Deal';
      document.getElementById('deal-id').value = deal.id;
      document.getElementById('deal-name').value = deal.name;
      document.getElementById('deal-value').value = deal.value;
      document.getElementById('deal-stage').value = deal.stage;
      _modalContactIds = getDealContactIds(deal);
      deleteBtn.style.display = 'inline-flex';

      // Set deal type
      const dealType = deal.type || 'recurring';
      document.getElementById('deal-type').value = dealType;
      document.querySelectorAll('.deal-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === dealType);
      });
      document.getElementById('deal-value-label').textContent = dealType === 'one_time' ? 'Project Value ($)' : 'Monthly Value ($)';
      document.getElementById('deal-owner').value = deal.owner || '';
      document.getElementById('deal-follow-up').value = deal.followUpDate || '';

      // Load comments
      _modalComments = getDealComments(deal);
    } else {
      titleEl.textContent = 'New Deal';
      form.reset();
      document.getElementById('deal-id').value = '';
      deleteBtn.style.display = 'none';

      // Reset type toggle to recurring
      document.getElementById('deal-type').value = 'recurring';
      document.querySelectorAll('.deal-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === 'recurring');
      });
      document.getElementById('deal-value-label').textContent = 'Monthly Value ($)';

      _modalContactIds = [];
      _modalComments = [];
    }

    renderDealContactChips();
    document.getElementById('deal-contact-picker').style.display = _modalContactIds.length === 0 ? '' : 'none';
    document.getElementById('deal-contact').value = '';
    renderDealComments();
    updateEditContactBtnVisibility();
    loadDealEmails(dealId);
    modal.classList.add('show');
  }

  // ===== Deal Email Thread Viewer =====
  async function loadDealEmails(dealId) {
    var emailSection = document.getElementById('deal-email-section');
    var threadContainer = document.getElementById('deal-email-thread');
    var threadList = document.getElementById('deal-email-thread-list');
    var loadingEl = document.getElementById('deal-email-loading');

    // Hide email section by default
    emailSection.style.display = 'none';
    threadContainer.style.display = 'none';

    if (!_gmailAccessToken || !dealId) return;

    var deals = Store.getDeals();
    var deal = deals.find(function (d) { return d.id === dealId; });
    var cids = deal ? getDealContactIds(deal) : [];
    if (cids.length === 0) return;

    var contacts = Store.getContacts();
    var dealContacts = cids.map(function (cid) { return contacts.find(function (c) { return c.id === cid; }); }).filter(function (c) { return c && c.email; });
    if (dealContacts.length === 0) return;

    // Show the email section
    emailSection.style.display = '';

    // Set up toggle — load emails for first contact with email
    var toggle = document.getElementById('deal-email-toggle');
    toggle.onclick = function () {
      var isHidden = threadContainer.style.display === 'none';
      threadContainer.style.display = isHidden ? '' : 'none';
      toggle.classList.toggle('expanded', isHidden);
      if (isHidden && threadList.innerHTML === '') {
        fetchAndRenderEmails(dealContacts[0].email, threadList, loadingEl);
      }
    };
  }

  async function fetchAndRenderEmails(contactEmail, listEl, loadingEl) {
    loadingEl.style.display = '';
    listEl.innerHTML = '';

    var threads = await fetchThreadsForContact(contactEmail);
    if (!threads || threads.length === 0) {
      loadingEl.style.display = 'none';
      listEl.innerHTML = '<div class="email-empty">No emails found with this contact</div>';
      return;
    }

    // Load first 5 threads with details
    var threadDetails = [];
    for (var i = 0; i < Math.min(threads.length, 5); i++) {
      var detail = await fetchThreadDetail(threads[i].id);
      if (detail) threadDetails.push(detail);
    }

    loadingEl.style.display = 'none';

    if (threadDetails.length === 0) {
      listEl.innerHTML = '<div class="email-empty">No emails found with this contact</div>';
      return;
    }

    listEl.innerHTML = threadDetails.map(function (thread) {
      var firstMsg = thread.messages[0];
      var lastMsg = thread.messages[thread.messages.length - 1];
      var subject = getHeader(firstMsg, 'Subject') || '(no subject)';
      var date = getHeader(lastMsg, 'Date');
      var fromEmail = extractEmail(getHeader(lastMsg, 'From'));
      var isFromContact = fromEmail === contactEmail.toLowerCase();
      var snippet = thread.messages[thread.messages.length - 1].snippet || '';
      var msgCount = thread.messages.length;

      var dateStr = '';
      try {
        dateStr = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch (e) {
        dateStr = date;
      }

      return '<div class="email-thread-item' + (isFromContact ? ' from-contact' : '') + '" data-thread-id="' + thread.id + '">' +
        '<div class="email-thread-header">' +
          '<div class="email-thread-subject">' + escapeHtml(subject) + '</div>' +
          '<div class="email-thread-meta">' +
            (msgCount > 1 ? '<span class="email-msg-count">' + msgCount + '</span>' : '') +
            '<span class="email-thread-date">' + dateStr + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="email-thread-snippet">' + escapeHtml(snippet) + '</div>' +
      '</div>';
    }).join('');

    // Click to expand thread
    listEl.querySelectorAll('.email-thread-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var threadId = item.dataset.threadId;
        toggleThreadExpand(item, threadId);
      });
    });
  }

  async function toggleThreadExpand(itemEl, threadId) {
    var existing = itemEl.querySelector('.email-thread-messages');
    if (existing) {
      existing.remove();
      itemEl.classList.remove('expanded');
      return;
    }

    itemEl.classList.add('expanded');
    var messagesDiv = document.createElement('div');
    messagesDiv.className = 'email-thread-messages';
    messagesDiv.innerHTML = '<div class="email-loading">Loading messages...</div>';
    itemEl.appendChild(messagesDiv);

    // Fetch full thread
    var thread = await fetchThreadDetail(threadId);
    if (!thread || !thread.messages) {
      messagesDiv.innerHTML = '<div class="email-empty">Could not load messages</div>';
      return;
    }

    // Load full messages for body content
    var fullMessages = [];
    for (var i = 0; i < thread.messages.length; i++) {
      var full = await fetchFullMessage(thread.messages[i].id);
      if (full) fullMessages.push(full);
    }

    messagesDiv.innerHTML = fullMessages.map(function (msg) {
      var from = getHeader(msg, 'From');
      var fromAddr = extractEmail(from);
      var isSent = fromAddr === (_gmailUserEmail || '').toLowerCase();
      var date = getHeader(msg, 'Date');
      var body = getMessageBody(msg);
      // Truncate very long messages
      if (body.length > 1000) body = body.substring(0, 1000) + '...';

      var dateStr = '';
      try {
        dateStr = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch (e) {
        dateStr = date;
      }

      var displayFrom = from.replace(/<[^>]+>/, '').trim() || fromAddr;

      return '<div class="email-message ' + (isSent ? 'sent' : 'received') + '">' +
        '<div class="email-message-header">' +
          '<span class="email-message-from">' + escapeHtml(displayFrom) + '</span>' +
          '<span class="email-message-date">' + dateStr + '</span>' +
        '</div>' +
        '<div class="email-message-body">' + escapeHtml(body) + '</div>' +
      '</div>';
    }).join('');
  }

  function closeDealModal() {
    document.getElementById('deal-modal').classList.remove('show');
  }

  function saveDeal(e) {
    e.preventDefault();
    const id = document.getElementById('deal-id').value;
    const deals = Store.getDeals();

    // If inline contact fields are visible, create or update the contact
    const newContactFields = document.getElementById('deal-new-contact-fields');
    if (newContactFields.style.display !== 'none') {
      const firstName = document.getElementById('deal-contact-first').value.trim();
      const lastName = document.getElementById('deal-contact-last').value.trim();
      if (!firstName || !lastName) return; // form validation should catch this

      if (_editingContactId) {
        // Update existing contact
        const contacts = Store.getContacts();
        const contact = contacts.find(c => c.id === _editingContactId);
        if (contact) {
          contact.firstName = firstName;
          contact.lastName = lastName;
          contact.email = document.getElementById('deal-contact-email').value.trim();
          contact.company = document.getElementById('deal-contact-company').value.trim();
          contact.phone = document.getElementById('deal-contact-phone').value.trim();
          contact.title = document.getElementById('deal-contact-title').value.trim();
          contact.notes = document.getElementById('deal-contact-notes').value.trim();
          contact.updatedAt = new Date().toISOString();
          Store.saveContacts(contacts);
          Store.addActivity(`<strong>${firstName} ${lastName}</strong> contact was updated`, '#6366f1');
          renderContacts();
        }
      } else {
        // Create new contact
        const newContact = {
          id: generateId(),
          firstName,
          lastName,
          email: document.getElementById('deal-contact-email').value.trim(),
          company: document.getElementById('deal-contact-company').value.trim(),
          phone: document.getElementById('deal-contact-phone').value.trim(),
          title: document.getElementById('deal-contact-title').value.trim(),
          notes: document.getElementById('deal-contact-notes').value.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const contacts = Store.getContacts();
        contacts.push(newContact);
        Store.saveContacts(contacts);
        Store.addActivity(`<strong>${firstName} ${lastName}</strong> was added as a contact`, '#10b981');
        if (!_modalContactIds.includes(newContact.id)) {
          _modalContactIds.push(newContact.id);
        }
        renderContacts();
      }
    }

    // Also add any contact selected in the picker but not yet chipped
    const pickerVal = document.getElementById('deal-contact').value;
    if (pickerVal && !_modalContactIds.includes(pickerVal)) {
      _modalContactIds.push(pickerVal);
    }

    // If there's text in the comment input, add it as a comment before saving
    const pendingComment = document.getElementById('deal-comment-input').value.trim();
    if (pendingComment) {
      _modalComments.unshift({ text: pendingComment, date: new Date().toISOString() });
      document.getElementById('deal-comment-input').value = '';
    }

    const contactIds = _modalContactIds.slice();
    const dealData = {
      name: document.getElementById('deal-name').value.trim(),
      value: parseFloat(document.getElementById('deal-value').value) || 0,
      type: document.getElementById('deal-type').value,
      stage: document.getElementById('deal-stage').value,
      owner: document.getElementById('deal-owner').value,
      contactIds,
      contactId: contactIds[0] || null,
      followUpDate: document.getElementById('deal-follow-up').value || null,
      comments: _modalComments,
      updatedAt: new Date().toISOString()
    };

    if (id) {
      const idx = deals.findIndex(d => d.id === id);
      if (idx >= 0) {
        deals[idx] = { ...deals[idx], ...dealData };
        Store.saveDeals(deals);
        Store.addActivity(`<strong>${dealData.name}</strong> was updated`, '#3b82f6');
      }
    } else {
      dealData.id = generateId();
      dealData.createdAt = new Date().toISOString();
      deals.push(dealData);
      Store.saveDeals(deals);
      Store.addActivity(`<strong>${dealData.name}</strong> was added to ${getStageLabel(dealData.stage)}`, STAGE_COLORS[dealData.stage]);
    }

    Store.updateMrrHistory();
    closeDealModal();
    renderPipeline();
  }

  function deleteDeal() {
    const id = document.getElementById('deal-id').value;
    if (!id) return;
    const deals = Store.getDeals();
    const deal = deals.find(d => d.id === id);
    if (deal && confirm(`Delete "${deal.name}"? This cannot be undone.`)) {
      Store.saveDeals(deals.filter(d => d.id !== id));
      Store.addActivity(`<strong>${deal.name}</strong> was deleted`, '#ef4444');
      Store.updateMrrHistory();
      closeDealModal();
      renderPipeline();
    }
  }

  // ===== Contacts =====
  let selectedContactId = null;

  function renderContacts(searchQuery) {
    const contacts = Store.getContacts();
    const list = document.getElementById('contacts-list');
    let filtered = contacts;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = contacts.filter(c =>
        (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }

    list.innerHTML = '';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No contacts found</p></div>';
      return;
    }

    filtered.forEach(contact => {
      const initials = getInitials(contact.firstName, contact.lastName);
      const color = getAvatarColor(contact.firstName + contact.lastName);
      const item = document.createElement('div');
      item.className = `contact-item${contact.id === selectedContactId ? ' active' : ''}`;
      item.dataset.contactId = contact.id;
      item.innerHTML = `
        <div class="contact-avatar" style="background:${color}">${initials.toUpperCase()}</div>
        <div class="contact-item-info">
          <div class="contact-item-name">${escapeHtml(contact.firstName + ' ' + contact.lastName)}</div>
          <div class="contact-item-company">${escapeHtml(contact.company || contact.email || '')}</div>
        </div>
      `;
      item.addEventListener('click', () => showContactDetail(contact.id));
      list.appendChild(item);
    });
  }

  function showContactDetail(contactId) {
    selectedContactId = contactId;
    const contacts = Store.getContacts();
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Highlight active contact
    document.querySelectorAll('.contact-item').forEach(item => {
      item.classList.toggle('active', item.dataset.contactId === contactId);
    });

    const deals = Store.getDeals().filter(d => getDealContactIds(d).includes(contactId));
    const initials = getInitials(contact.firstName, contact.lastName);
    const color = getAvatarColor(contact.firstName + contact.lastName);

    const detail = document.getElementById('contact-detail');
    detail.innerHTML = `
      <div class="contact-detail-header">
        <div class="contact-detail-avatar" style="background:${color}">${initials.toUpperCase()}</div>
        <div>
          <div class="contact-detail-name">${escapeHtml(contact.firstName + ' ' + contact.lastName)}</div>
          <div class="contact-detail-title">${escapeHtml(contact.title || '')}${contact.title && contact.company ? ' at ' : ''}${escapeHtml(contact.company || '')}</div>
        </div>
      </div>

      <div class="contact-info-grid">
        <div class="info-item">
          <span class="info-label">Email</span>
          <span class="info-value">${escapeHtml(contact.email || '—')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Phone</span>
          <span class="info-value">${escapeHtml(contact.phone || '—')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Company</span>
          <span class="info-value">${escapeHtml(contact.company || '—')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Added</span>
          <span class="info-value">${formatDate(contact.createdAt)}</span>
        </div>
      </div>

      ${contact.notes ? `
        <div class="contact-section">
          <h4>Notes</h4>
          <div class="contact-notes">${escapeHtml(contact.notes)}</div>
        </div>
      ` : ''}

      <div class="contact-section">
        <h4>Deals (${deals.length})</h4>
        <div class="contact-deals-list">
          ${deals.length === 0 ? '<p style="color:var(--text-muted); font-size:13px;">No deals associated with this contact</p>' : ''}
          ${deals.map(d => `
            <div class="contact-deal-item" onclick="window.__openDeal('${d.id}')">
              <div>
                <div class="contact-deal-name">${escapeHtml(d.name)}</div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px">${formatCurrency(d.value)}${d.type === 'one_time' ? ' <span class="deal-type-badge one-time">One-Time</span>' : '/mo'}</div>
              </div>
              <span class="contact-deal-stage stage-${d.stage}">${getStageLabel(d.stage)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="contact-detail-actions">
        <button class="btn btn-primary" onclick="window.__editContact('${contact.id}')">Edit Contact</button>
        <button class="btn btn-danger" onclick="window.__deleteContact('${contact.id}')">Delete</button>
      </div>
    `;
  }

  // Expose functions for inline onclick handlers
  window.__openDeal = function (dealId) {
    switchView('pipeline');
    openDealModal(dealId);
  };

  window.__editContact = function (contactId) {
    openContactModal(contactId);
  };

  window.__deleteContact = function (contactId) {
    const contacts = Store.getContacts();
    const contact = contacts.find(c => c.id === contactId);
    if (contact && confirm(`Delete "${contact.firstName} ${contact.lastName}"? This cannot be undone.`)) {
      Store.saveContacts(contacts.filter(c => c.id !== contactId));
      Store.addActivity(`Contact <strong>${contact.firstName} ${contact.lastName}</strong> was deleted`, '#ef4444');
      selectedContactId = null;
      document.getElementById('contact-detail').innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <p>Select a contact to view details</p>
        </div>
      `;
      renderContacts();
    }
  };

  // ===== Contact Modal =====
  function openContactModal(contactId) {
    const modal = document.getElementById('contact-modal');
    const form = document.getElementById('contact-form');
    const titleEl = document.getElementById('contact-modal-title');
    const deleteBtn = document.getElementById('contact-delete');
    const dealsSection = document.getElementById('contact-deals-section');
    const dealsContainer = document.getElementById('contact-deals-stages');

    if (contactId) {
      const contacts = Store.getContacts();
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) return;

      titleEl.textContent = 'Edit Contact';
      document.getElementById('contact-id').value = contact.id;
      document.getElementById('contact-first').value = contact.firstName;
      document.getElementById('contact-last').value = contact.lastName;
      document.getElementById('contact-company').value = contact.company || '';
      document.getElementById('contact-email').value = contact.email || '';
      document.getElementById('contact-phone').value = contact.phone || '';
      document.getElementById('contact-title').value = contact.title || '';
      document.getElementById('contact-notes').value = contact.notes || '';
      deleteBtn.style.display = 'inline-flex';

      // Show associated deals with stage dropdowns
      const deals = Store.getDeals().filter(d => getDealContactIds(d).includes(contactId));
      if (deals.length > 0) {
        dealsSection.style.display = '';
        dealsContainer.innerHTML = deals.map(d => `
          <div class="contact-deal-row">
            <span class="contact-deal-row-name">${escapeHtml(d.name)}</span>
            <select data-deal-id="${d.id}">
              ${STAGES.map(s => `<option value="${s}"${d.stage === s ? ' selected' : ''}>${getStageLabel(s)}</option>`).join('')}
            </select>
          </div>
        `).join('');
      } else {
        dealsSection.style.display = 'none';
        dealsContainer.innerHTML = '';
      }
    } else {
      titleEl.textContent = 'New Contact';
      form.reset();
      document.getElementById('contact-id').value = '';
      deleteBtn.style.display = 'none';
      dealsSection.style.display = 'none';
      dealsContainer.innerHTML = '';
    }

    modal.classList.add('show');
  }

  function closeContactModal() {
    document.getElementById('contact-modal').classList.remove('show');
  }

  function saveContact(e) {
    e.preventDefault();
    const id = document.getElementById('contact-id').value;
    const contacts = Store.getContacts();
    const contactData = {
      firstName: document.getElementById('contact-first').value.trim(),
      lastName: document.getElementById('contact-last').value.trim(),
      company: document.getElementById('contact-company').value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      phone: document.getElementById('contact-phone').value.trim(),
      title: document.getElementById('contact-title').value.trim(),
      notes: document.getElementById('contact-notes').value.trim(),
      updatedAt: new Date().toISOString()
    };

    if (id) {
      const idx = contacts.findIndex(c => c.id === id);
      if (idx >= 0) {
        contacts[idx] = { ...contacts[idx], ...contactData };
        Store.saveContacts(contacts);
        Store.addActivity(`<strong>${contactData.firstName} ${contactData.lastName}</strong> was updated`, '#3b82f6');
      }

      // Save any deal stage changes from the contact modal
      const stageSelects = document.querySelectorAll('#contact-deals-stages select[data-deal-id]');
      if (stageSelects.length > 0) {
        const deals = Store.getDeals();
        let dealsChanged = false;
        stageSelects.forEach(sel => {
          const deal = deals.find(d => d.id === sel.dataset.dealId);
          if (deal && deal.stage !== sel.value) {
            const oldStage = deal.stage;
            deal.stage = sel.value;
            deal.updatedAt = new Date().toISOString();
            dealsChanged = true;
            Store.addActivity(
              `<strong>${deal.name}</strong> moved from ${getStageLabel(oldStage)} to ${getStageLabel(sel.value)}`,
              STAGE_COLORS[sel.value]
            );
          }
        });
        if (dealsChanged) {
          Store.saveDeals(deals);
          Store.updateMrrHistory();
        }
      }
    } else {
      contactData.id = generateId();
      contactData.createdAt = new Date().toISOString();
      contacts.push(contactData);
      Store.saveContacts(contacts);
      Store.addActivity(`<strong>${contactData.firstName} ${contactData.lastName}</strong> was added as a contact`, '#10b981');
    }

    closeContactModal();
    renderContacts();
    renderPipeline();
    if (selectedContactId === id) {
      showContactDetail(id);
    }
  }

  function deleteContactFromModal() {
    const id = document.getElementById('contact-id').value;
    if (id) {
      window.__deleteContact(id);
      closeContactModal();
    }
  }


  // ===== MRR Mission Display (Sidebar) =====
  function updateMrrDisplay() {
    const mrr = Store.calculateMRR();
    const goal = getMrrGoal();
    const pct = goal > 0 ? Math.min((mrr / goal) * 100, 100) : 0;

    document.getElementById('sidebar-mrr').textContent = formatCurrency(mrr);
    document.getElementById('rocket-bar-fill').style.height = pct + '%';
    document.getElementById('rocket-ship').style.bottom = pct + '%';
    document.getElementById('rocket-pct').textContent = Math.round(pct) + '%';
    document.getElementById('rocket-goal-value').textContent = formatCurrency(goal);

    // Highlight reached milestones
    document.querySelectorAll('.mission-milestones .milestone').forEach(m => {
      const pos = parseFloat(m.style.bottom);
      m.classList.toggle('reached', pct >= pos);
    });

    // Goal reached celebration
    const tracker = document.querySelector('.mission-tracker');
    if (tracker) {
      tracker.classList.toggle('goal-reached', pct >= 100);
    }
  }

  // ===== Search =====
  function initSearch() {
    const searchInput = document.getElementById('contact-search');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderContacts(searchInput.value.trim());
      }, 200);
    });
  }

  // ===== Event Listeners =====
  function initEventListeners() {
    // Deal modal
    document.getElementById('btn-add-deal').addEventListener('click', () => openDealModal(null));
    document.getElementById('deal-modal-close').addEventListener('click', closeDealModal);
    document.getElementById('deal-cancel').addEventListener('click', closeDealModal);
    document.getElementById('deal-form').addEventListener('submit', saveDeal);
    document.getElementById('deal-delete').addEventListener('click', deleteDeal);
    document.getElementById('deal-new-contact-toggle').addEventListener('click', toggleDealNewContact);
    document.getElementById('deal-edit-contact-btn').addEventListener('click', toggleDealEditContact);
    document.getElementById('deal-contact').addEventListener('change', function () {
      updateEditContactBtnVisibility();
      // Auto-add selected contact and hide picker
      const cid = this.value;
      if (cid && !_modalContactIds.includes(cid)) {
        _modalContactIds.push(cid);
        renderDealContactChips();
        this.value = '';
        document.getElementById('deal-contact-picker').style.display = 'none';
        resetDealNewContactFields();
      }
    });
    document.getElementById('deal-contact-add-btn').addEventListener('click', showContactPicker);
    document.getElementById('deal-add-comment').addEventListener('click', addDealComment);
    document.getElementById('deal-comment-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addDealComment();
      }
    });

    // Deal type toggle
    document.querySelectorAll('.deal-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.deal-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        document.getElementById('deal-type').value = type;
        document.getElementById('deal-value-label').textContent = type === 'one_time' ? 'Project Value ($)' : 'Monthly Value ($)';
      });
    });

    // Contact modal (from Contacts page and Pipeline page)
    document.getElementById('btn-add-contact').addEventListener('click', () => openContactModal(null));
    document.getElementById('btn-add-contact-pipeline').addEventListener('click', () => openContactModal(null));
    document.getElementById('contact-modal-close').addEventListener('click', closeContactModal);
    document.getElementById('contact-cancel').addEventListener('click', closeContactModal);
    document.getElementById('contact-form').addEventListener('submit', saveContact);
    document.getElementById('contact-delete').addEventListener('click', deleteContactFromModal);

    // Close modals on overlay click
    document.getElementById('deal-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDealModal();
    });
    document.getElementById('contact-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeContactModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDealModal();
        closeContactModal();
      }
    });

    // Editable MRR goal
    const goalRow = document.getElementById('rocket-goal-row');
    const goalInput = document.getElementById('rocket-goal-input');

    goalRow.addEventListener('click', () => {
      if (goalRow.classList.contains('editing')) return;
      goalRow.classList.add('editing');
      goalInput.value = getMrrGoal();
      goalInput.focus();
      goalInput.select();
    });

    function commitGoalEdit() {
      const val = parseFloat(goalInput.value);
      if (val && val > 0) {
        setMrrGoal(val);
      }
      goalRow.classList.remove('editing');
      updateMrrDisplay();
    }

    goalInput.addEventListener('blur', commitGoalEdit);
    goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goalInput.blur();
      }
      if (e.key === 'Escape') {
        goalRow.classList.remove('editing');
        updateMrrDisplay();
      }
    });

    // Prevent click on input from re-triggering the row click
    goalInput.addEventListener('click', (e) => e.stopPropagation());
  }

  // ===== Column Rename =====
  function initColumnRename() {
    document.querySelectorAll('.pipeline-column').forEach(col => {
      const stage = col.dataset.stage;
      const h3 = col.querySelector('.column-header h3');

      h3.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (h3.querySelector('.stage-rename-input')) return;

        const current = getStageLabel(stage);
        h3.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'stage-rename-input';
        input.value = current;
        input.maxLength = 30;
        h3.appendChild(input);
        input.focus();
        input.select();

        function commit() {
          const val = input.value.trim();
          if (val && val !== STAGE_LABELS[stage]) {
            setStageLabel(stage, val);
          } else if (val === STAGE_LABELS[stage]) {
            // Reset to default if user typed the default back
            delete _cache.stageLabels[stage];
            localStorage.setItem('crm_stage_labels', JSON.stringify(_cache.stageLabels));
            if (_useFirebase) {
              db.collection('crm').doc('settings').set(
                { stageLabels: _cache.stageLabels },
                { merge: true }
              );
            }
          }
          h3.textContent = getStageLabel(stage);
        }

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { h3.textContent = getStageLabel(stage); }
        });
      });
    });
  }

  // ===== Initialize =====
  function init() {
    initNavigation();
    initDragDrop();
    initEventListeners();
    initSearch();
    initColumnRename();

    // Load data from Firestore (if configured), then render
    loadInitialData().then(() => {
      renderPipeline();
      Store.updateMrrHistory();
      initFirebaseListeners();
      // Start Gmail email monitoring if token available
      if (_gmailAccessToken) {
        startEmailMonitor();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initAuthGate(init);
  });
})();
