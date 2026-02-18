// =============================================
// PaidCreative CRM - Application Logic
// =============================================

(function () {
  'use strict';

  // ===== Constants =====
  const MRR_GOAL = 83000;
  const STAGES = ['discovery', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
  const STAGE_LABELS = {
    discovery: 'Discovery',
    qualification: 'Qualification',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
    closed_won: 'Closed Won',
    closed_lost: 'Closed Lost'
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
      return JSON.parse(localStorage.getItem('crm_deals') || '[]');
    },
    saveDeals(deals) {
      localStorage.setItem('crm_deals', JSON.stringify(deals));
    },
    getContacts() {
      return JSON.parse(localStorage.getItem('crm_contacts') || '[]');
    },
    saveContacts(contacts) {
      localStorage.setItem('crm_contacts', JSON.stringify(contacts));
    },
    getActivities() {
      return JSON.parse(localStorage.getItem('crm_activities') || '[]');
    },
    saveActivities(activities) {
      localStorage.setItem('crm_activities', JSON.stringify(activities));
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
      return JSON.parse(localStorage.getItem('crm_mrr_history') || '[]');
    },
    saveMrrHistory(history) {
      localStorage.setItem('crm_mrr_history', JSON.stringify(history));
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

    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'contacts') renderContacts();
    if (viewName === 'pipeline') renderPipeline();
  }

  // ===== Pipeline =====
  function renderPipeline() {
    const deals = Store.getDeals();

    STAGES.forEach(stage => {
      const body = document.querySelector(`.column-body[data-stage="${stage}"]`);
      const countEl = document.querySelector(`[data-count="${stage}"]`);
      const stageDeals = deals.filter(d => d.stage === stage);

      countEl.textContent = stageDeals.length;
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
  }

  function initDragDrop() {
    document.querySelectorAll('.column-body').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });

      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!draggedDealId) return;

        const newStage = col.dataset.stage;
        const deals = Store.getDeals();
        const deal = deals.find(d => d.id === draggedDealId);

        if (deal && deal.stage !== newStage) {
          const oldStage = deal.stage;
          deal.stage = newStage;
          deal.updatedAt = new Date().toISOString();
          Store.saveDeals(deals);
          Store.addActivity(
            `<strong>${deal.name}</strong> moved from ${STAGE_LABELS[oldStage]} to ${STAGE_LABELS[newStage]}`,
            STAGE_COLORS[newStage]
          );
          Store.updateMrrHistory();
          renderPipeline();
        }
        draggedDealId = null;
      });
    });
  }

  // ===== Deal Modal =====
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
    const dealData = {
      name: document.getElementById('deal-name').value.trim(),
      value: parseFloat(document.getElementById('deal-value').value) || 0,
      stage: document.getElementById('deal-stage').value,
      contactId: document.getElementById('deal-contact').value || null,
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
    } else {
      titleEl.textContent = 'New Contact';
      form.reset();
      document.getElementById('contact-id').value = '';
      deleteBtn.style.display = 'none';
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
    } else {
      contactData.id = generateId();
      contactData.createdAt = new Date().toISOString();
      contacts.push(contactData);
      Store.saveContacts(contacts);
      Store.addActivity(`<strong>${contactData.firstName} ${contactData.lastName}</strong> was added as a contact`, '#10b981');
    }

    closeContactModal();
    renderContacts();
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

  // ===== Dashboard =====
  let mrrChart = null;
  let stageChart = null;

  function renderDashboard() {
    renderGoalTracker();
    renderPipelineSummary();
    renderMrrChart();
    renderStageChart();
    renderActivityFeed();
    renderTopDeals();
  }

  function renderGoalTracker() {
    const mrr = Store.calculateMRR();
    const pct = Math.min((mrr / MRR_GOAL) * 100, 100);
    const remaining = Math.max(MRR_GOAL - mrr, 0);
    const circumference = 2 * Math.PI * 85; // ~534

    document.getElementById('dash-current-mrr').textContent = formatCurrency(mrr);
    document.getElementById('goal-percent').textContent = Math.round(pct) + '%';
    document.getElementById('goal-remaining').textContent =
      remaining > 0
        ? `${formatCurrency(remaining)} remaining to reach goal`
        : 'Goal reached!';

    const circle = document.getElementById('goal-circle');
    const offset = circumference - (pct / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  function renderPipelineSummary() {
    const deals = Store.getDeals();
    const totalDeals = deals.length;
    const totalValue = deals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
    const wonDeals = deals.filter(d => d.stage === 'closed_won').length;
    const closedDeals = deals.filter(d => d.stage === 'closed_won' || d.stage === 'closed_lost').length;
    const winRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
    const activeDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage)).length;

    document.getElementById('pipeline-summary').innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${totalDeals}</div>
        <div class="stat-label">Total Deals</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${formatCurrency(totalValue)}</div>
        <div class="stat-label">Total Pipeline</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${activeDeals}</div>
        <div class="stat-label">Active Deals</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${winRate}%</div>
        <div class="stat-label">Win Rate</div>
      </div>
    `;
  }

  function renderMrrChart() {
    const history = Store.getMrrHistory();
    const ctx = document.getElementById('mrr-chart').getContext('2d');

    // Build labels and data - show at least 6 months
    let labels = [];
    let data = [];

    if (history.length === 0) {
      // Show empty chart with current month
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        data.push(0);
      }
    } else {
      history.forEach(h => {
        const [year, month] = h.month.split('-');
        const d = new Date(parseInt(year), parseInt(month) - 1, 1);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        data.push(h.value);
      });
    }

    if (mrrChart) mrrChart.destroy();

    mrrChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'MRR',
            data,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#6366f1',
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2
          },
          {
            label: 'Goal',
            data: labels.map(() => MRR_GOAL),
            borderColor: 'rgba(16, 185, 129, 0.4)',
            borderDash: [8, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#64748b' },
            grid: { color: 'rgba(51, 65, 85, 0.5)' }
          },
          y: {
            ticks: {
              color: '#64748b',
              callback: (val) => formatCurrency(val)
            },
            grid: { color: 'rgba(51, 65, 85, 0.5)' },
            beginAtZero: true
          }
        }
      }
    });
  }

  function renderStageChart() {
    const deals = Store.getDeals();
    const ctx = document.getElementById('stage-chart').getContext('2d');

    const stageCounts = STAGES.map(s => deals.filter(d => d.stage === s).length);
    const stageLabels = STAGES.map(s => STAGE_LABELS[s]);
    const colors = STAGES.map(s => STAGE_COLORS[s]);

    if (stageChart) stageChart.destroy();

    stageChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: stageLabels,
        datasets: [{
          data: stageCounts,
          backgroundColor: colors,
          borderColor: '#1e293b',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', font: { size: 12 }, padding: 12 }
          }
        },
        cutout: '60%'
      }
    });
  }

  function renderActivityFeed() {
    const activities = Store.getActivities();
    const feed = document.getElementById('activity-feed');

    if (activities.length === 0) {
      feed.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No recent activity</p>';
      return;
    }

    feed.innerHTML = activities.slice(0, 10).map(a => `
      <div class="activity-item">
        <div class="activity-dot" style="background:${a.color}"></div>
        <div>
          <div class="activity-text">${a.text}</div>
          <div class="activity-time">${timeAgo(a.time)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderTopDeals() {
    const deals = Store.getDeals()
      .filter(d => d.stage !== 'closed_lost')
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const container = document.getElementById('top-deals');

    if (deals.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No deals yet</p>';
      return;
    }

    container.innerHTML = deals.map(d => `
      <div class="top-deal-item">
        <div>
          <div class="top-deal-name">${escapeHtml(d.name)}</div>
          <span class="contact-deal-stage stage-${d.stage}" style="font-size:11px">${STAGE_LABELS[d.stage]}</span>
        </div>
        <div class="top-deal-value">${formatCurrency(d.value)}/mo</div>
      </div>
    `).join('');
  }

  // ===== MRR Display (Sidebar) =====
  function updateMrrDisplay() {
    const mrr = Store.calculateMRR();
    const pct = Math.min((mrr / MRR_GOAL) * 100, 100);
    document.getElementById('sidebar-mrr').textContent = formatCurrency(mrr);
    document.getElementById('sidebar-mrr-fill').style.width = pct + '%';
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

    // Contact modal
    document.getElementById('btn-add-contact').addEventListener('click', () => openContactModal(null));
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
  }

  // ===== Initialize =====
  function init() {
    initNavigation();
    initDragDrop();
    initEventListeners();
    initSearch();
    renderPipeline();
    Store.updateMrrHistory();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
