/* ============================================================
PFADI KRIENS – FINANZEN
app.js – Hauptlogik
Supabase Projekt: vecofpjmmyebljrdwojn
============================================================ */

// ---------- Supabase Client ----------
const SUPABASE_URL = 'https://vecofpjmmyebljrdwojn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T4LmXrksdyKBP6-Q5ag1Zg_AwnpHNoq';
const ADMIN_EMAIL = 'leo.j.daeniker@bluewin.ch';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- State ----------
let formConfig = null;
let allSubmissions = [];
let editingQuestionIdx = null;
let currentUser = null;

// Members state
let membersUnlocked = false;
let currentGruppe = 'Biber';
let currentKontenGruppe = 'Biber';
let editingEintragId = null;

const GRUPPEN = ['Biber', 'Auroras', 'Apollos', 'Mapfis', 'Bupfis', 'Pios', 'Rover'];

// SHA-256 of "Mitglieder2026!" – used as fallback if no setting stored yet
const MEMBERS_PW_FALLBACK = '9737b41acf0113e49b3de3f8a6960f4030f754622767f8bcb2e28594deb1f18f';

/* ============================================================
SHA-256 HELPER
============================================================ */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
NAVIGATION
============================================================ */
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById('sec-' + name);
  const btn = document.querySelector(`.nav-btn[data-section="${name}"]`);
  if (sec) sec.classList.remove('hidden');
  if (btn) btn.classList.add('active');

  if (name === 'verwaltung' && currentUser) {
    showAdminDashboard();
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

/* ============================================================
FORM – LADEN & RENDERN
============================================================ */
async function loadForm() {
  const { data, error } = await db
    .from('form_config')
    .select('config')
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    document.getElementById('form-container').innerHTML =
      '<p class="msg-error">Formular konnte nicht geladen werden. Bitte Seite neu laden.</p>';
    return;
  }

  formConfig = data.config;
  renderForm(formConfig);
}

function renderForm(config) {
  const container = document.getElementById('form-container');
  let html = '<form id="main-form" novalidate>';

  config.questions.forEach(q => {
    const isConditional = !!q.showIf;
    html += `<div class="form-group question-group${isConditional ? ' hidden' : ''}"
      data-qid="${q.id}"
      data-showif='${JSON.stringify(q.showIf || null)}'>`;

    html += `<label>${escHtml(q.label)}${q.required ? ' <span class="required">*</span>' : ''}</label>`;

    if (q.hint) {
      html += `<p class="hint">${escHtml(q.hint)}</p>`;
    }

    if (q.type === 'radio') {
      (q.options || []).forEach(opt => {
        html += `<label class="radio-label">
          <input type="radio" name="${q.id}" value="${escHtml(opt)}"${q.required ? ' required' : ''}>
          ${escHtml(opt)}
        </label>`;
      });
    } else if (q.type === 'file') {
      html += `<input type="file" name="${q.id}"
        accept="${escHtml(q.accept || 'image/*,.pdf,.doc,.docx,.xls,.xlsx')}"
        ${q.required ? 'required' : ''}>`;
    } else {
      if (q.placeholder) {
        html += `<p class="hint">${escHtml(q.placeholder)}</p>`;
      }
      html += `<input type="${q.type}" name="${q.id}"
        placeholder=""
        ${q.required ? 'required' : ''}>`;
    }

    html += '</div>';
  });

  html += `
    <button type="submit" class="btn btn-primary btn-submit">Einreichen</button>
    <div id="form-status" class="hidden"></div>
  `;
  html += '</form>';

  container.innerHTML = html;
  setupBranching(config);
  document.getElementById('main-form').addEventListener('submit', handleFormSubmit);
}

/* ============================================================
FORM – BRANCHING
============================================================ */
function setupBranching(config) {
  config.questions.forEach(q => {
    if (q.type === 'radio') {
      document.querySelectorAll(`input[name="${q.id}"]`).forEach(radio => {
        radio.addEventListener('change', () => updateVisibility(config));
      });
    }
  });
  updateVisibility(config);
}

function updateVisibility(config) {
  config.questions.forEach(q => {
    if (!q.showIf) return;
    const group = document.querySelector(`.question-group[data-qid="${q.id}"]`);
    if (!group) return;

    const triggerChecked = document.querySelector(
      `input[name="${q.showIf.question}"][value="${q.showIf.value}"]:checked`
    );

    if (triggerChecked) {
      group.classList.remove('hidden');
    } else {
      group.classList.add('hidden');
      group.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
        else el.value = '';
      });
    }
  });
}

/* ============================================================
FORM – EINREICHUNG
============================================================ */
async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const statusEl = document.getElementById('form-status');
  const submitBtn = form.querySelector('.btn-submit');

  let valid = true;
  formConfig.questions.forEach(q => {
    const group = document.querySelector(`.question-group[data-qid="${q.id}"]`);
    if (!group || group.classList.contains('hidden')) return;
    if (!q.required) return;

    if (q.type === 'radio') {
      const checked = form.querySelector(`input[name="${q.id}"]:checked`);
      if (!checked) { valid = false; }
    } else if (q.type === 'file') {
      const fi = form.querySelector(`input[name="${q.id}"]`);
      if (!fi || !fi.files.length) { valid = false; }
    } else {
      const inp = form.querySelector(`input[name="${q.id}"]`);
      if (!inp || !inp.value.trim()) { valid = false; }
    }
  });

  if (!valid) {
    showStatus(statusEl, 'Bitte alle Pflichtfelder ausfüllen.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird eingereicht…';
  statusEl.classList.add('hidden');

  const formData = {};
  let fileToUpload = null;

  formConfig.questions.forEach(q => {
    const group = document.querySelector(`.question-group[data-qid="${q.id}"]`);
    if (!group || group.classList.contains('hidden')) return;

    if (q.type === 'radio') {
      const checked = form.querySelector(`input[name="${q.id}"]:checked`);
      formData[q.id] = checked ? checked.value : '';
    } else if (q.type === 'file') {
      const fi = form.querySelector(`input[name="${q.id}"]`);
      if (fi && fi.files[0]) fileToUpload = fi.files[0];
    } else {
      const inp = form.querySelector(`input[name="${q.id}"]`);
      formData[q.id] = inp ? inp.value.trim() : '';
    }
  });

  let belege_url = null;
  if (fileToUpload) {
    const ext = fileToUpload.name.split('.').pop();
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { data: upData, error: upErr } = await db.storage
      .from('belege')
      .upload(safeName, fileToUpload);

    if (upErr) {
      showStatus(statusEl, 'Fehler beim Hochladen des Belegs: ' + upErr.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Einreichen';
      return;
    }
    belege_url = upData.path;
  }

  const { data: insertedRow, error: insertErr } = await db.from('submissions').insert({
    name: formData.name || null,
    email: formData.email || null,
    titel: formData.titel || null,
    projekt: formData.projekt || null,
    beleg_datum: formData.beleg_datum || null,
    betrag: parseFloat(formData.betrag) || null,
    bezahlt_via: formData.bezahlt_via || null,
    rechnung_status: formData.rechnung_status || null,
    debit_card: formData.debit_card || null,
    iban: formData.iban || null,
    adresse: formData.adresse || null,
    beleg_url: belege_url,
    form_data: formData
  }).select('id').single();

  if (insertErr) {
    showStatus(statusEl, 'Fehler beim Einreichen: ' + insertErr.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Einreichen';
    return;
  }

  // Auto-create ledger entry if projekt matches a gruppe
  const projektGruppe = (formData.projekt || '').trim();
  if (GRUPPEN.includes(projektGruppe) && formData.betrag && parseFloat(formData.betrag) > 0) {
    const eintragText = [formData.titel, formData.name].filter(Boolean).join(' – ') || 'Einreichung';
    await db.from('ledger_entries').insert({
      gruppe: projektGruppe,
      datum: formData.beleg_datum || new Date().toISOString().slice(0, 10),
      text: eintragText,
      ausgabe: parseFloat(formData.betrag),
      einnahme: null,
      source: 'submission',
      source_id: insertedRow?.id || null
    });
  }

  showStatus(statusEl, '✓ Beleg erfolgreich eingereicht! Danke.', 'success');
  form.reset();
  updateVisibility(formConfig);
  submitBtn.disabled = false;
  submitBtn.textContent = 'Einreichen';
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = type === 'error' ? 'msg-error' : 'msg-success';
  el.classList.remove('hidden');
}

/* ============================================================
MEMBERS – PASSWORD
============================================================ */
async function getMembersPasswordHash() {
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('key', 'members_password_hash')
    .single();
  return data?.value || MEMBERS_PW_FALLBACK;
}

document.getElementById('btn-members-login').addEventListener('click', async () => {
  const pwd = document.getElementById('members-password').value;
  const errorEl = document.getElementById('members-login-error');
  errorEl.classList.add('hidden');

  if (!pwd) {
    errorEl.textContent = 'Bitte Passwort eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }

  const hash = await sha256(pwd);
  const storedHash = await getMembersPasswordHash();

  if (hash === storedHash) {
    membersUnlocked = true;
    document.getElementById('members-login').classList.add('hidden');
    document.getElementById('members-dashboard').classList.remove('hidden');
    // Activate first group tab
    document.querySelector('.members-tabs .tab-btn').classList.add('active');
    loadLedger('Biber');
  } else {
    errorEl.textContent = 'Falsches Passwort.';
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('members-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-members-login').click();
});

document.getElementById('btn-members-logout').addEventListener('click', () => {
  membersUnlocked = false;
  document.getElementById('members-login').classList.remove('hidden');
  document.getElementById('members-dashboard').classList.add('hidden');
  document.getElementById('members-password').value = '';
  document.getElementById('members-login-error').classList.add('hidden');
  document.getElementById('members-ledger-content').innerHTML = '<p class="loading-text">Wird geladen…</p>';
});

// Group tab clicks in Members
document.querySelectorAll('.members-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.members-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGruppe = btn.dataset.gruppe;
    loadLedger(currentGruppe);
  });
});

/* ============================================================
MEMBERS – LEDGER DISPLAY
============================================================ */
async function loadLedger(gruppe) {
  const container = document.getElementById('members-ledger-content');
  container.innerHTML = '<p class="loading-text">Wird geladen…</p>';

  const { data, error } = await db
    .from('ledger_entries')
    .select('*')
    .eq('gruppe', gruppe)
    .order('datum', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p class="msg-error">Fehler: ${escHtml(error.message)}</p>`;
    return;
  }

  renderLedger(gruppe, data || []);
}

function renderLedger(gruppe, entries) {
  const container = document.getElementById('members-ledger-content');

  // Calculate running saldo
  let saldo = 0;
  const rows = entries.map(e => {
    const ein = e.einnahme ? Number(e.einnahme) : 0;
    const aus = e.ausgabe ? Number(e.ausgabe) : 0;
    saldo += ein - aus;
    return { ...e, _saldo: saldo };
  });

  const salClass = saldo > 0 ? 'saldo-pos' : saldo < 0 ? 'saldo-neg' : 'saldo-zero';
  const salFormatted = (saldo < 0 ? '– ' : '') + 'CHF ' + Math.abs(saldo).toFixed(2);

  let html = `
    <div class="ledger-saldo-card">
      <div>
        <div class="saldo-label">Aktueller Saldo</div>
        <div class="saldo-gruppe">${escHtml(gruppe)}</div>
      </div>
      <div class="saldo-value">${escHtml(salFormatted)}</div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div class="ledger-table-wrapper">
  `;

  if (!rows.length) {
    html += '<p style="padding:24px;color:#888;font-size:14px;text-align:center">Noch keine Einträge vorhanden.</p>';
  } else {
    html += `
      <table class="ledger">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Text</th>
            <th class="num">Einnahme</th>
            <th class="num">Ausgabe</th>
            <th class="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
    `;

    rows.forEach(r => {
      const datum = r.datum
        ? new Date(r.datum + 'T12:00:00').toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '—';
      const einStr = r.einnahme ? 'CHF ' + Number(r.einnahme).toFixed(2) : '';
      const ausStr = r.ausgabe ? 'CHF ' + Number(r.ausgabe).toFixed(2) : '';
      const salStr = (r._saldo < 0 ? '– ' : '') + 'CHF ' + Math.abs(r._saldo).toFixed(2);
      const sc = r._saldo > 0 ? 'cell-saldo-pos' : r._saldo < 0 ? 'cell-saldo-neg' : 'cell-saldo-zero';
      const pill = r.source === 'submission' ? '<span class="source-pill">Einreichung</span>' : '';

      html += `<tr>
        <td>${escHtml(datum)}</td>
        <td>${escHtml(r.text)}${pill}</td>
        <td class="num${einStr ? ' cell-einnahme' : ''}">${escHtml(einStr)}</td>
        <td class="num${ausStr ? ' cell-ausgabe' : ''}">${escHtml(ausStr)}</td>
        <td class="num ${escHtml(sc)}">${escHtml(salStr)}</td>
      </tr>`;
    });

    html += '</tbody></table>';
  }

  html += '</div></div>';
  container.innerHTML = html;
}

/* ============================================================
ADMIN – LOGIN / LOGOUT
============================================================ */
document.getElementById('btn-login').addEventListener('click', async () => {
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  const { data, error } = await db.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
  if (error) {
    errorEl.textContent = 'Anmeldung fehlgeschlagen: ' + error.message;
    errorEl.classList.remove('hidden');
    return;
  }

  currentUser = data.user;
  showAdminDashboard();
});

document.getElementById('admin-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null;
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
});

db.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    currentUser = session.user;
    const verw = document.getElementById('sec-verwaltung');
    if (verw && !verw.classList.contains('hidden')) {
      showAdminDashboard();
    }
  }
});

function showAdminDashboard() {
  document.getElementById('admin-login').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');
  loadSubmissions();
  loadFormBuilder();
}

/* ============================================================
ADMIN TABS
============================================================ */
document.querySelectorAll('#admin-dashboard .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#admin-dashboard .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.remove('hidden');

    if (btn.dataset.tab === 'konten') {
      loadKonten(currentKontenGruppe);
    }
  });
});

/* ============================================================
SUBMISSIONS – LADEN & ANZEIGEN
============================================================ */
async function loadSubmissions() {
  const container = document.getElementById('submissions-container');
  container.innerHTML = '<p class="loading-text">Einreichungen werden geladen…</p>';

  const { data, error } = await db
    .from('submissions')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) {
    container.innerHTML = '<p class="msg-error">Fehler beim Laden: ' + error.message + '</p>';
    return;
  }

  allSubmissions = data || [];

  const projekts = [...new Set(allSubmissions.map(s => s.projekt).filter(Boolean))].sort();
  const sel = document.getElementById('filter-projekt');
  sel.innerHTML = '<option value="">Alle Projekte</option>';
  projekts.forEach(p => {
    sel.innerHTML += `<option value="${escHtml(p)}">${escHtml(p)}</option>`;
  });

  renderSubmissionsTable(allSubmissions);
}

function renderSubmissionsTable(data) {
  const container = document.getElementById('submissions-container');

  if (!data.length) {
    container.innerHTML = '<p style="color:#888;font-size:14px;padding:16px 0">Keine Einreichungen gefunden.</p>';
    return;
  }

  let rows = '';
  data.forEach(s => {
    const datum = s.submitted_at
      ? new Date(s.submitted_at).toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const betrag = s.betrag != null ? 'CHF ' + Number(s.betrag).toFixed(2) : '—';
    const bezahlt = [s.bezahlt_via, s.debit_card, s.rechnung_status].filter(Boolean).join(' / ');
    const belegLk = s.beleg_url
      ? `<a href="javascript:void(0)" onclick="openBeleg('${s.id}','${escHtml(s.beleg_url)}')">Öffnen</a>`
      : '—';
      const teamsBtn = s.email
      ? `<a href="javascript:void(0)" onclick="sendTeams('${escHtml(s.email)}',${s.betrag != null ? s.betrag : 0})" class="btn-action btn-teams" title="Teams Nachricht">Teams</a>`
      : '';
    const emailBtn = s.email
      ? `<a href="javascript:void(0)" onclick="sendEmail('${escHtml(s.email)}','${escHtml(s.name || '')}','${escHtml(s.titel || '')}')" class="btn-action btn-email" title="E-Mail senden">Mail</a>`
      : '';    rows += `<tr>
      <td>${datum}</td>
      <td>${escHtml(s.name || '')}${s.email ? `<small>${escHtml(s.email)}</small>` : ''}</td>
      <td>${escHtml(s.projekt || '—')}</td>
      <td>${escHtml(s.titel || '—')}</td>
      <td class="amount">${betrag}</td>
      <td>${escHtml(bezahlt || '—')}</td>
      <td class="iban">${escHtml(s.iban || '—')}</td>
      <td>${belegLk}</td>
      <td style="white-space:nowrap">${teamsBtn}${emailBtn}<button data-cid="${s.id}" data-cv="${!!s.contacted}" class="btn-icon btn-contacted${s.contacted ? ' contacted-yes' : ''}" onclick="toggleContacted('${s.id}',${!!s.contacted})" title="${s.contacted ? 'Kontaktiert' : 'Ausstehend'}">${s.contacted ? '✓' : '○'}</button><button class="btn-action btn-delete" title="Löschen" onclick="deleteSubmission('${s.id}','${escHtml(s.beleg_url||'')}')">🗑</button></td>
    </tr>`;
  });

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Eingereicht</th>
            <th>Name / E-Mail</th>
            <th>Projekt</th>
            <th>Titel</th>
            <th>Betrag</th>
            <th>Bezahlt via</th>
            <th>IBAN</th>
            <th>Beleg</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function openBeleg(id, path) {
  const { data, error } = await db.storage
    .from('belege')
    .createSignedUrl(path, 120);

  if (error || !data?.signedUrl) {
    showToast('Beleg konnte nicht geöffnet werden.', 'error');
    return;
  }
  window.open(data.signedUrl, '_blank');
}

function sendEmail(email, name, titel) {
  const subject = encodeURIComponent('Pfadi Kriens Finanzen – ' + (titel || 'Einreichung'));
  const body = encodeURIComponent('Hallo ' + (name || '') + ',\n\n');
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
}

function sendTeams(email, betrag) {
  const today = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const betragStr = betrag > 0 ? Number(betrag).toFixed(2) : '?';
  const msg = `Beste Dank fürs Ihreiche vum Beleg, CHF ${betragStr} werded am ${today} uf diis Konto Zahlt`;
  const url = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}&message=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

async function deleteSubmission(id, beleguUrl) {
  if (!confirm('Diese Einreichung wirklich löschen? Der verknüpfte Kontoeintrag wird ebenfalls entfernt.')) return;
  // Delete linked ledger entry
  await db.from('ledger_entries').delete().eq('source_id', id).eq('source', 'submission');
  // Delete file from storage
  if (beleguUrl) {
    await db.storage.from('belege').remove([beleguUrl]);
  }
  // Delete submission
  const { error } = await db.from('submissions').delete().eq('id', id);
  if (error) {
    showToast('Fehler: ' + error.message, 'error');
  } else {
    showToast('Einreichung gelöscht.');
    allSubmissions = allSubmissions.filter(s => s.id !== id);
    renderSubmissionsTable(allSubmissions);
  }
}

async function toggleContacted(id, current) {
  const newVal = !current;
  const { error } = await db.from('submissions').update({ contacted: newVal }).eq('id', id);
  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
  // Update in-memory state
  const s = allSubmissions.find(s => s.id === id);
  if (s) s.contacted = newVal;
  // Update button without full reload
  const btn = document.querySelector('[data-cid="' + id + '"]');
  if (btn) {
    btn.dataset.cv = newVal;
    btn.classList.toggle('contacted-yes', newVal);
    btn.title = newVal ? 'Kontaktiert' : 'Ausstehend';
    btn.textContent = newVal ? '✓' : '○';
    btn.onclick = function() { toggleContacted(id, newVal); };
  }
  showToast(newVal ? 'Als kontaktiert markiert.' : 'Markierung entfernt.');
}

function applyFilters() {
  const search = document.getElementById('filter-search').value.toLowerCase();
  const projekt = document.getElementById('filter-projekt').value;
  const bezahlt = document.getElementById('filter-bezahlt').value;
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;

  const filtered = allSubmissions.filter(s => {
    if (search && !JSON.stringify(s).toLowerCase().includes(search)) return false;
    if (projekt && s.projekt !== projekt) return false;
    if (bezahlt && s.bezahlt_via !== bezahlt) return false;
    if (from && s.beleg_datum && s.beleg_datum < from) return false;
    if (to && s.beleg_datum && s.beleg_datum > to) return false;
    return true;
  });

  renderSubmissionsTable(filtered);
}

['filter-search','filter-projekt','filter-bezahlt','filter-from','filter-to'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', applyFilters);
  document.getElementById(id)?.addEventListener('change', applyFilters);
});

document.getElementById('btn-export-excel').addEventListener('click', () => {
  if (!allSubmissions.length) {
    showToast('Keine Einreichungen zum Exportieren.', 'error');
    return;
  }

  const rows = allSubmissions.map(s => ({
    'Eingereicht am': s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('de-CH') : '',
    'Name': s.name || '',
    'E-Mail': s.email || '',
    'Titel': s.titel || '',
    'Projekt': s.projekt || '',
    'Beleg Datum': s.beleg_datum || '',
    'Betrag (CHF)': s.betrag != null ? Number(s.betrag) : '',
    'Bezahlt via': s.bezahlt_via || '',
    'Debit Card': s.debit_card || '',
    'Rechnungsstatus': s.rechnung_status || '',
    'IBAN': s.iban || '',
    'Adresse': s.adresse || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    {wch:14},{wch:20},{wch:26},{wch:28},{wch:14},{wch:10},
    {wch:12},{wch:12},{wch:14},{wch:18},{wch:26},{wch:32}
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Belege');
  XLSX.writeFile(wb, `Belege_Pfadi_Kriens_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Excel exportiert!');
});

/* ============================================================
KONTEN – ADMIN TAB
============================================================ */
document.querySelectorAll('.gruppe-selector .gruppe-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gruppe-selector .gruppe-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentKontenGruppe = btn.dataset.gruppe;
    loadKonten(currentKontenGruppe);
  });
});

async function loadKonten(gruppe) {
  const container = document.getElementById('konten-table-container');
  container.innerHTML = '<p class="loading-text">Wird geladen…</p>';

  const { data, error } = await db
    .from('ledger_entries')
    .select('*')
    .eq('gruppe', gruppe)
    .order('datum', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p class="msg-error">Fehler: ${escHtml(error.message)}</p>`;
    return;
  }

  renderKontenTable(gruppe, data || []);
}

function renderKontenTable(gruppe, entries) {
  const container = document.getElementById('konten-table-container');

  // Running saldo
  let saldo = 0;
  const rows = entries.map(e => {
    const ein = e.einnahme ? Number(e.einnahme) : 0;
    const aus = e.ausgabe ? Number(e.ausgabe) : 0;
    saldo += ein - aus;
    return { ...e, _saldo: saldo };
  });

  const salStr = (saldo < 0 ? '– ' : '') + 'CHF ' + Math.abs(saldo).toFixed(2);
  const salCls = saldo > 0 ? 'ks-pos' : saldo < 0 ? 'ks-neg' : 'ks-zero';

  let html = `
    <div class="konten-saldo-strip">
      <span class="ks-label">Saldo ${escHtml(gruppe)}</span>
      <span class="ks-value ${salCls}">${escHtml(salStr)}</span>
    </div>
  `;

  if (!rows.length) {
    html += '<p style="color:#888;font-size:14px;padding:8px 0">Noch keine Einträge. Klicke «+ Eintrag» um zu beginnen.</p>';
  } else {
    html += `
      <div class="ledger-table-wrapper">
        <table class="ledger">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Text</th>
              <th class="num">Einnahme</th>
              <th class="num">Ausgabe</th>
              <th class="num">Saldo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;

    rows.forEach(r => {
      const datum = r.datum
        ? new Date(r.datum + 'T12:00:00').toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '—';
      const einStr = r.einnahme ? 'CHF ' + Number(r.einnahme).toFixed(2) : '';
      const ausStr = r.ausgabe ? 'CHF ' + Number(r.ausgabe).toFixed(2) : '';
      const rSalStr = (r._saldo < 0 ? '– ' : '') + 'CHF ' + Math.abs(r._saldo).toFixed(2);
      const sc = r._saldo > 0 ? 'cell-saldo-pos' : r._saldo < 0 ? 'cell-saldo-neg' : 'cell-saldo-zero';
      const isSubmission = r.source === 'submission';
      const pill = isSubmission ? '<span class="source-pill">Auto</span>' : '';

      const actions = isSubmission
        ? `<button class="btn-icon btn-danger" title="Löschen" onclick="deleteEintrag('${r.id}')">🗑️</button>`
        : `<button class="btn-icon" title="Bearbeiten" onclick="editEintrag('${r.id}','${escHtml(r.datum || '')}','${escHtml(r.text || '')}',${r.einnahme || 0},${r.ausgabe || 0})">✏️</button>
           <button class="btn-icon btn-danger" title="Löschen" onclick="deleteEintrag('${r.id}')">🗑️</button>`;

      html += `<tr>
        <td>${escHtml(datum)}</td>
        <td>${escHtml(r.text)}${pill}</td>
        <td class="num${einStr ? ' cell-einnahme' : ''}">${escHtml(einStr)}</td>
        <td class="num${ausStr ? ' cell-ausgabe' : ''}">${escHtml(ausStr)}</td>
        <td class="num ${escHtml(sc)}">${escHtml(rSalStr)}</td>
        <td style="white-space:nowrap;text-align:right">
          <div class="question-actions">${actions}</div>
        </td>
      </tr>`;
    });

    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
}

// Open add modal
document.getElementById('btn-add-eintrag').addEventListener('click', () => {
  editingEintragId = null;
  document.getElementById('eintrag-modal-title').textContent = 'Eintrag hinzufügen';
  document.getElementById('e-datum').value = new Date().toISOString().slice(0, 10);
  document.getElementById('e-text').value = '';
  document.getElementById('e-betrag').value = '';
  document.querySelector('input[name="e-typ"][value="ausgabe"]').checked = true;
  document.getElementById('eintrag-modal-overlay').classList.remove('hidden');
  document.getElementById('e-text').focus();
});

// Edit an existing entry
function editEintrag(id, datum, text, einnahme, ausgabe) {
  editingEintragId = id;
  document.getElementById('eintrag-modal-title').textContent = 'Eintrag bearbeiten';
  document.getElementById('e-datum').value = datum;
  document.getElementById('e-text').value = text;

  if (einnahme > 0) {
    document.querySelector('input[name="e-typ"][value="einnahme"]').checked = true;
    document.getElementById('e-betrag').value = einnahme;
  } else {
    document.querySelector('input[name="e-typ"][value="ausgabe"]').checked = true;
    document.getElementById('e-betrag').value = ausgabe;
  }

  document.getElementById('eintrag-modal-overlay').classList.remove('hidden');
  document.getElementById('e-text').focus();
}

// Delete an entry
async function deleteEintrag(id) {
  if (!confirm('Eintrag wirklich löschen?')) return;

  const { error } = await db.from('ledger_entries').delete().eq('id', id);
  if (error) {
    showToast('Fehler: ' + error.message, 'error');
  } else {
    showToast('Eintrag gelöscht.');
    loadKonten(currentKontenGruppe);
  }
}

// Save (add or edit)
document.getElementById('btn-eintrag-save').addEventListener('click', async () => {
  const datum = document.getElementById('e-datum').value;
  const text = document.getElementById('e-text').value.trim();
  const typ = document.querySelector('input[name="e-typ"]:checked').value;
  const betragRaw = parseFloat(document.getElementById('e-betrag').value);

  if (!datum || !text || isNaN(betragRaw) || betragRaw <= 0) {
    showToast('Bitte alle Felder ausfüllen.', 'error');
    return;
  }

  const payload = {
    gruppe: currentKontenGruppe,
    datum,
    text,
    einnahme: typ === 'einnahme' ? betragRaw : null,
    ausgabe: typ === 'ausgabe' ? betragRaw : null,
    source: 'manual'
  };

  let error;
  if (editingEintragId) {
    ({ error } = await db.from('ledger_entries').update(payload).eq('id', editingEintragId));
  } else {
    ({ error } = await db.from('ledger_entries').insert(payload));
  }

  if (error) {
    showToast('Fehler: ' + error.message, 'error');
    return;
  }

  showToast(editingEintragId ? 'Eintrag aktualisiert.' : 'Eintrag gespeichert.', 'success');
  document.getElementById('eintrag-modal-overlay').classList.add('hidden');
  loadKonten(currentKontenGruppe);
});

document.getElementById('btn-eintrag-cancel').addEventListener('click', () => {
  document.getElementById('eintrag-modal-overlay').classList.add('hidden');
});

document.getElementById('eintrag-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('eintrag-modal-overlay')) {
    document.getElementById('eintrag-modal-overlay').classList.add('hidden');
  }
});

/* ============================================================
FORM BUILDER – ANZEIGEN
============================================================ */
function loadFormBuilder() {
  if (!formConfig) return;
  renderQuestionsList(formConfig.questions);
}

function renderQuestionsList(questions) {
  const list = document.getElementById('questions-list');

  if (!questions.length) {
    list.innerHTML = '<p style="color:#888;font-size:14px;padding:8px 0">Noch keine Fragen vorhanden.</p>';
    return;
  }

  list.innerHTML = '';
  questions.forEach((q, i) => {
    const typeLabel = {
      text:'Text', email:'E-Mail', number:'Zahl', date:'Datum',
      radio:'Auswahl', file:'Datei'
    }[q.type] || q.type;

    const tags = [typeLabel];
    if (q.required) tags.push('Pflicht');
    if (q.showIf) tags.push('Bedingt');

    const div = document.createElement('div');
    div.className = 'question-item';
    div.innerHTML = `
      <div class="question-info">
        <span class="q-index">${i + 1}</span>
        <div>
          <strong>${escHtml(q.label)}</strong>
          <small>${tags.join(' · ')}</small>
        </div>
      </div>
      <div class="question-actions">
        <button class="btn-icon" title="Nach oben" onclick="moveQuestion(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn-icon" title="Nach unten" onclick="moveQuestion(${i}, 1)" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn-icon" title="Bearbeiten" onclick="editQuestion(${i})">✏️</button>
        <button class="btn-icon btn-danger" title="Löschen" onclick="deleteQuestion(${i})">🗑️</button>
      </div>`;
    list.appendChild(div);
  });
}

function moveQuestion(index, direction) {
  const qs = formConfig.questions;
  const newIdx = index + direction;
  if (newIdx < 0 || newIdx >= qs.length) return;
  [qs[index], qs[newIdx]] = [qs[newIdx], qs[index]];
  renderQuestionsList(qs);
}

function deleteQuestion(index) {
  if (!confirm(`Frage "${formConfig.questions[index].label}" löschen?`)) return;
  formConfig.questions.splice(index, 1);
  renderQuestionsList(formConfig.questions);
}

/* ============================================================
FORM BUILDER – MODAL
============================================================ */
document.getElementById('btn-add-question').addEventListener('click', () => {
  editingQuestionIdx = null;
  openQuestionModal(null);
});

function editQuestion(index) {
  editingQuestionIdx = index;
  openQuestionModal(formConfig.questions[index]);
}

function openQuestionModal(q) {
  document.getElementById('modal-title').textContent = q ? 'Frage bearbeiten' : 'Frage hinzufügen';

  document.getElementById('q-label').value = q?.label || '';
  document.getElementById('q-type').value = q?.type || 'text';
  document.getElementById('q-placeholder').value = q?.placeholder || q?.hint || '';
  document.getElementById('q-required').checked = q?.required || false;
  document.getElementById('q-options').value = (q?.options || []).join('\n');

  const showifSel = document.getElementById('q-showif-question');
  showifSel.innerHTML = '<option value="">Immer anzeigen</option>';
  formConfig.questions.forEach((fq) => {
    if (fq.type !== 'radio') return;
    const selected = (q?.showIf?.question === fq.id) ? 'selected' : '';
    showifSel.innerHTML += `<option value="${fq.id}" ${selected}>${escHtml(fq.label)}</option>`;
  });

  document.getElementById('q-showif-value').value = q?.showIf?.value || '';

  updateModalDependentFields();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('q-label').focus();
}

function updateModalDependentFields() {
  const type = document.getElementById('q-type').value;
  const showifQ = document.getElementById('q-showif-question').value;

  document.getElementById('q-options-group')
    .classList.toggle('hidden', type !== 'radio');
  document.getElementById('q-showif-value')
    .classList.toggle('hidden', !showifQ);
}

document.getElementById('q-type').addEventListener('change', updateModalDependentFields);
document.getElementById('q-showif-question').addEventListener('change', updateModalDependentFields);

document.getElementById('btn-modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.add('hidden');
  }
});

document.getElementById('btn-modal-save').addEventListener('click', () => {
  const label = document.getElementById('q-label').value.trim();
  if (!label) { alert('Bitte einen Fragetext eingeben.'); return; }

  const type = document.getElementById('q-type').value;
  const placeholder = document.getElementById('q-placeholder').value.trim();
  const required = document.getElementById('q-required').checked;
  const optionsRaw = document.getElementById('q-options').value.trim();
  const options = type === 'radio'
    ? optionsRaw.split('\n').map(o => o.trim()).filter(Boolean)
    : undefined;

  if (type === 'radio' && (!options || !options.length)) {
    alert('Bitte mindestens eine Option eingeben.');
    return;
  }

  const showifQ = document.getElementById('q-showif-question').value;
  const showifV = document.getElementById('q-showif-value').value.trim();
  const showIf = (showifQ && showifV) ? { question: showifQ, value: showifV } : undefined;

  const id = editingQuestionIdx !== null
    ? formConfig.questions[editingQuestionIdx].id
    : label.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 25) + '_' + Date.now().toString(36);

  const newQ = {
    id, type, label, required,
    ...(placeholder ? { placeholder } : {}),
    ...(options ? { options } : {}),
    ...(showIf ? { showIf } : {})
  };

  if (editingQuestionIdx !== null) {
    formConfig.questions[editingQuestionIdx] = newQ;
  } else {
    formConfig.questions.push(newQ);
  }

  renderQuestionsList(formConfig.questions);
  document.getElementById('modal-overlay').classList.add('hidden');
});

/* ============================================================
FORM BUILDER – SPEICHERN / JSON BACKUP
============================================================ */
document.getElementById('btn-save-form').addEventListener('click', async () => {
  const { error } = await db
    .from('form_config')
    .update({ config: formConfig, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) {
    showToast('Fehler beim Speichern: ' + error.message, 'error');
  } else {
    showToast('Formular gespeichert!', 'success');
    renderForm(formConfig);
  }
});

document.getElementById('btn-download-json').addEventListener('click', () => {
  downloadJson(formConfig, `form_config_${new Date().toISOString().slice(0,10)}.json`);
  showToast('JSON Backup heruntergeladen.');
});

document.getElementById('btn-upload-json').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed.questions || !Array.isArray(parsed.questions)) throw new Error('Ungültige Struktur');
      formConfig = parsed;
      renderQuestionsList(formConfig.questions);
      showToast('JSON geladen. Klicke "Speichern" um zu übernehmen.');
    } catch {
      showToast('Ungültige JSON-Datei.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ============================================================
EINSTELLUNGEN – ADMIN PASSWORT
============================================================ */
document.getElementById('btn-change-password').addEventListener('click', async () => {
  const newPwd = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;
  const statusEl = document.getElementById('password-status');

  statusEl.classList.add('hidden');

  if (!newPwd || newPwd.length < 8) {
    statusEl.textContent = 'Passwort muss mindestens 8 Zeichen lang sein.';
    statusEl.className = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirm) {
    statusEl.textContent = 'Passwörter stimmen nicht überein.';
    statusEl.className = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }

  const { error } = await db.auth.updateUser({ password: newPwd });
  if (error) {
    statusEl.textContent = 'Fehler: ' + error.message;
    statusEl.className = 'msg-error';
  } else {
    statusEl.textContent = '✓ Admin-Passwort erfolgreich geändert.';
    statusEl.className = 'msg-success';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
  }
  statusEl.classList.remove('hidden');
});

/* ============================================================
EINSTELLUNGEN – MEMBERS PASSWORT
============================================================ */
document.getElementById('btn-change-members-password').addEventListener('click', async () => {
  const newPwd = document.getElementById('new-members-password').value;
  const confirm = document.getElementById('confirm-members-password').value;
  const statusEl = document.getElementById('members-password-status');

  statusEl.classList.add('hidden');

  if (!newPwd || newPwd.length < 6) {
    statusEl.textContent = 'Passwort muss mindestens 6 Zeichen lang sein.';
    statusEl.className = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirm) {
    statusEl.textContent = 'Passwörter stimmen nicht überein.';
    statusEl.className = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }

  const hash = await sha256(newPwd);
  const { error } = await db
    .from('settings')
    .upsert({ key: 'members_password_hash', value: hash, updated_at: new Date().toISOString() });

  if (error) {
    statusEl.textContent = 'Fehler: ' + error.message;
    statusEl.className = 'msg-error';
  } else {
    statusEl.textContent = '✓ Members-Passwort erfolgreich geändert.';
    statusEl.className = 'msg-success';
    document.getElementById('new-members-password').value = '';
    document.getElementById('confirm-members-password').value = '';
  }
  statusEl.classList.remove('hidden');
});

/* ============================================================
EINSTELLUNGEN – BACKUP
============================================================ */
document.getElementById('btn-backup-config').addEventListener('click', () => {
  if (!formConfig) { showToast('Kein Formular geladen.', 'error'); return; }
  downloadJson(formConfig, `form_config_${new Date().toISOString().slice(0,10)}.json`);
  showToast('Formular-Backup heruntergeladen.');
});

document.getElementById('btn-backup-submissions').addEventListener('click', async () => {
  const { data, error } = await db
    .from('submissions')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (error) { showToast('Fehler beim Laden: ' + error.message, 'error'); return; }
  downloadJson(data, `einreichungen_${new Date().toISOString().slice(0,10)}.json`);
  showToast('Einreichungen-Backup heruntergeladen.');
});

/* ============================================================
HILFSFUNKTIONEN
============================================================ */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
INITIALISIERUNG
============================================================ */
loadForm();
