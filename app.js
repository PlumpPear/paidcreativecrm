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

  // ===== Constants =====
  const DEFAULT_MRR_GOAL = 83000;

  // Local cache (populated from Firestore or localStorage)
  let _cache = {
    deals: JSON.parse(localStorage.getItem('crm_deals') || '[]'),
    contacts: JSON.parse(localStorage.getItem('crm_contacts') || '[]'),
    activities: JSON.parse(localStorage.getItem('crm_activities') || '[]'),
    mrrHistory: JSON.parse(localStorage.getItem('crm_mrr_history') || '[]'),
    mrrGoal: parseFloat(localStorage.getItem('crm_mrr_goal')) || DEFAULT_MRR_GOAL
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
        .filter(d => d.stage === 'closed_won')
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
      }
    });
  }

  // Load initial data from Firestore (first load seeds cache)
  function loadInitialData() {
    if (!_useFirebase) return Promise.resolve();

    return db.collection('crm').get().then(snapshot => {
      snapshot.forEach(doc => {
        const data = doc.data();
        switch (doc.id) {
          case 'deals':
            if (data.items) {
              _cache.deals = data.items;
              localStorage.setItem('crm_deals', JSON.stringify(data.items));
            }
            break;
          case 'contacts':
            if (data.items) {
              _cache.contacts = data.items;
              localStorage.setItem('crm_contacts', JSON.stringify(data.items));
            }
            break;
          case 'activities':
            if (data.items) {
              _cache.activities = data.items;
              localStorage.setItem('crm_activities', JSON.stringify(data.items));
            }
            break;
          case 'settings':
            if (data.mrrHistory) {
              _cache.mrrHistory = data.mrrHistory;
              localStorage.setItem('crm_mrr_history', JSON.stringify(data.mrrHistory));
            }
            if (data.mrrGoal != null) {
              _cache.mrrGoal = data.mrrGoal;
              localStorage.setItem('crm_mrr_goal', data.mrrGoal.toString());
            }
            break;
        }
      });
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

  // ===== Pipeline =====
  function renderPipeline() {
    const deals = Store.getDeals();

    STAGES.forEach(stage => {
      const body = document.querySelector(`.column-body[data-stage="${stage}"]`);
      const countEl = document.querySelector(`[data-count="${stage}"]`);
      const stageDeals = deals.filter(d => d.stage === stage)
        .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));

      countEl.textContent = stageDeals.length;
      const totalEl = document.querySelector(`[data-total="${stage}"]`);
      const stageTotal = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
      totalEl.textContent = formatCurrency(stageTotal);
      body.innerHTML = '';

      stageDeals.forEach(deal => {
        const contacts = Store.getContacts();
        const contact = contacts.find(c => c.id === deal.contactId);
        const companyText = contact ? (contact.company || `${contact.firstName} ${contact.lastName}`) : '';

        const card = document.createElement('div');
        card.className = 'deal-card';
        card.draggable = true;
        card.dataset.dealId = deal.id;
        card.innerHTML = `
          <div class="deal-card-name">${escapeHtml(deal.name)}</div>
          ${companyText ? `<div class="deal-card-company">${escapeHtml(companyText)}</div>` : ''}
          <div class="deal-card-footer">
            <span class="deal-card-value">${formatCurrency(deal.value)}/mo</span>
            <span class="deal-card-date">${formatDate(deal.createdAt)}</span>
          </div>
        `;

        card.addEventListener('click', () => openDealModal(deal.id));
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        body.appendChild(card);
      });
    });

    updateMrrDisplay();
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
            `<strong>${deal.name}</strong> moved from ${STAGE_LABELS[oldStage]} to ${STAGE_LABELS[newStage]}`,
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
    const fields = document.getElementById('deal-new-contact-fields');
    fields.style.display = 'none';
    document.getElementById('deal-contact-first').value = '';
    document.getElementById('deal-contact-last').value = '';
    document.getElementById('deal-contact-email').value = '';
    document.getElementById('deal-contact-company').value = '';
    document.getElementById('deal-contact-first').removeAttribute('required');
    document.getElementById('deal-contact-last').removeAttribute('required');
    const toggleBtn = document.getElementById('deal-new-contact-toggle');
    toggleBtn.textContent = '+ New';
    document.getElementById('deal-contact').disabled = false;
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
      fields.style.display = '';
      contactSelect.value = '';
      contactSelect.disabled = true;
      toggleBtn.textContent = 'Cancel';
      document.getElementById('deal-contact-first').setAttribute('required', '');
      document.getElementById('deal-contact-last').setAttribute('required', '');
    }
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

    // Reset inline new-contact fields
    resetDealNewContactFields();

    if (dealId) {
      const deals = Store.getDeals();
      const deal = deals.find(d => d.id === dealId);
      if (!deal) return;

      titleEl.textContent = 'Edit Deal';
      document.getElementById('deal-id').value = deal.id;
      document.getElementById('deal-name').value = deal.name;
      document.getElementById('deal-value').value = deal.value;
      document.getElementById('deal-stage').value = deal.stage;
      document.getElementById('deal-contact').value = deal.contactId || '';
      document.getElementById('deal-notes').value = deal.notes || '';
      deleteBtn.style.display = 'inline-flex';
    } else {
      titleEl.textContent = 'New Deal';
      form.reset();
      document.getElementById('deal-id').value = '';
      deleteBtn.style.display = 'none';
    }

    modal.classList.add('show');
  }

  function closeDealModal() {
    document.getElementById('deal-modal').classList.remove('show');
  }

  function saveDeal(e) {
    e.preventDefault();
    const id = document.getElementById('deal-id').value;
    const deals = Store.getDeals();

    // If inline new-contact fields are visible, create the contact first
    let contactId = document.getElementById('deal-contact').value || null;
    const newContactFields = document.getElementById('deal-new-contact-fields');
    if (newContactFields.style.display !== 'none') {
      const firstName = document.getElementById('deal-contact-first').value.trim();
      const lastName = document.getElementById('deal-contact-last').value.trim();
      if (!firstName || !lastName) return; // form validation should catch this

      const newContact = {
        id: generateId(),
        firstName,
        lastName,
        email: document.getElementById('deal-contact-email').value.trim(),
        company: document.getElementById('deal-contact-company').value.trim(),
        phone: '',
        title: '',
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const contacts = Store.getContacts();
      contacts.push(newContact);
      Store.saveContacts(contacts);
      Store.addActivity(`<strong>${firstName} ${lastName}</strong> was added as a contact`, '#10b981');
      contactId = newContact.id;
      renderContacts();
    }

    const dealData = {
      name: document.getElementById('deal-name').value.trim(),
      value: parseFloat(document.getElementById('deal-value').value) || 0,
      stage: document.getElementById('deal-stage').value,
      contactId,
      notes: document.getElementById('deal-notes').value.trim(),
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
      Store.addActivity(`<strong>${dealData.name}</strong> was added to ${STAGE_LABELS[dealData.stage]}`, STAGE_COLORS[dealData.stage]);
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

    const deals = Store.getDeals().filter(d => d.contactId === contactId);
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
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px">${formatCurrency(d.value)}/mo</div>
              </div>
              <span class="contact-deal-stage stage-${d.stage}">${STAGE_LABELS[d.stage]}</span>
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
      const deals = Store.getDeals().filter(d => d.contactId === contactId);
      if (deals.length > 0) {
        dealsSection.style.display = '';
        dealsContainer.innerHTML = deals.map(d => `
          <div class="contact-deal-row">
            <span class="contact-deal-row-name">${escapeHtml(d.name)}</span>
            <select data-deal-id="${d.id}">
              ${STAGES.map(s => `<option value="${s}"${d.stage === s ? ' selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
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
              `<strong>${deal.name}</strong> moved from ${STAGE_LABELS[oldStage]} to ${STAGE_LABELS[sel.value]}`,
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


  // ===== MRR Rocket Display (Sidebar) =====
  function updateMrrDisplay() {
    const mrr = Store.calculateMRR();
    const goal = getMrrGoal();
    const pct = goal > 0 ? Math.min((mrr / goal) * 100, 100) : 0;

    document.getElementById('sidebar-mrr').textContent = formatCurrency(mrr);
    document.getElementById('rocket-bar-fill').style.height = pct + '%';
    document.getElementById('rocket-ship').style.bottom = pct + '%';
    document.getElementById('rocket-pct').textContent = Math.round(pct) + '%';
    document.getElementById('rocket-goal-value').textContent = formatCurrency(goal);

    // Boost flame visibility when there's progress
    const flame = document.querySelector('.rocket-flame');
    if (flame) {
      flame.style.opacity = pct > 0 ? '1' : '0.4';
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

  // ===== Initialize =====
  function init() {
    initNavigation();
    initDragDrop();
    initEventListeners();
    initSearch();

    // Load data from Firestore (if configured), then render
    loadInitialData().then(() => {
      renderPipeline();
      Store.updateMrrHistory();
      initFirebaseListeners();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
