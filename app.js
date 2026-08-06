/* ============================================================
   PFADI KRIENS – FINANZEN
   app.js – Hauptlogik
   Supabase Projekt: vecofpjmmyebljrdwojn
   ============================================================ */

// ---------- Supabase Client ----------
const SUPABASE_URL  = 'https://vecofpjmmyebljrdwojn.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_T4LmXrksdyKBP6-Q5ag1Zg_AwnpHNoq';
const ADMIN_EMAIL   = 'leo.j.daeniker@bluewin.ch';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- State ----------
let formConfig          = null;   // form_config.config aus Supabase
let allSubmissions      = [];     // alle Einreichungen (nach Login geladen)
let editingQuestionIdx  = null;   // Index der Frage, die gerade bearbeitet wird
let currentUser         = null;   // eingeloggter Admin

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

  // Wenn Verwaltung geöffnet wird und User eingeloggt ist → Dashboard zeigen
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

    if (q.placeholder && q.type !== 'radio' && q.type !== 'file') {
      // Hint shown below label for non-radio, non-file fields with a placeholder text as hint
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
   FORM – BRANCHING (bedingte Felder)
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
  const form      = e.target;
  const statusEl  = document.getElementById('form-status');
  const submitBtn = form.querySelector('.btn-submit');

  // Pflichtfelder prüfen (nur sichtbare)
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

  submitBtn.disabled    = true;
  submitBtn.textContent = 'Wird eingereicht…';
  statusEl.classList.add('hidden');

  // Formulardaten sammeln (nur sichtbare Felder)
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

  // Datei hochladen
  let belege_url = null;
  if (fileToUpload) {
    const ext      = fileToUpload.name.split('.').pop();
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { data: upData, error: upErr } = await db.storage
      .from('belege')
      .upload(safeName, fileToUpload);

    if (upErr) {
      showStatus(statusEl, 'Fehler beim Hochladen des Belegs: ' + upErr.message, 'error');
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Einreichen';
      return;
    }
    belege_url = upData.path;
  }

  // Einreichung in Datenbank speichern
  // Bekannte Felder werden explizit gemappt; alle Felder zusätzlich als form_data JSONB gespeichert
  const { error: insertErr } = await db.from('submissions').insert({
    name:             formData.name            || null,
    email:            formData.email           || null,
    titel:            formData.titel           || null,
    projekt:          formData.projekt         || null,
    beleg_datum:      formData.beleg_datum     || null,
    betrag:           parseFloat(formData.betrag) || null,
    bezahlt_via:      formData.bezahlt_via     || null,
    rechnung_status:  formData.rechnung_status || null,
    debit_card:       formData.debit_card      || null,
    iban:             formData.iban            || null,
    adresse:          formData.adresse         || null,
    beleg_url:        belege_url,
    form_data:        formData
  });

  if (insertErr) {
    showStatus(statusEl, 'Fehler beim Einreichen: ' + insertErr.message, 'error');
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Einreichen';
    return;
  }

  // Erfolg
  showStatus(statusEl, '✓ Beleg erfolgreich eingereicht! Danke.', 'success');
  form.reset();
  updateVisibility(formConfig);
  submitBtn.disabled    = false;
  submitBtn.textContent = 'Einreichen';
}

function showStatus(el, msg, type) {
  el.textContent  = msg;
  el.className    = type === 'error' ? 'msg-error' : 'msg-success';
  el.classList.remove('hidden');
}

/* ============================================================
   ADMIN – LOGIN / LOGOUT
   ============================================================ */
document.getElementById('btn-login').addEventListener('click', async () => {
  const password  = document.getElementById('admin-password').value;
  const errorEl   = document.getElementById('login-error');
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

// Enter-Taste im Passwortfeld
document.getElementById('admin-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await db.auth.signOut();
  currentUser = null;
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
});

// Eingeloggt bleiben (Session wiederherstellen)
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
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.remove('hidden');
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
    const datum   = s.submitted_at
      ? new Date(s.submitted_at).toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const betrag  = s.betrag != null ? 'CHF ' + Number(s.betrag).toFixed(2) : '—';
    const bezahlt = [s.bezahlt_via, s.debit_card, s.rechnung_status].filter(Boolean).join(' / ');
    const belegLk = s.beleg_url
      ? `<a href="javascript:void(0)" onclick="openBeleg('${s.id}','${escHtml(s.beleg_url)}')">Öffnen</a>`
      : '—';

    rows += `<tr>
      <td>${datum}</td>
      <td>${escHtml(s.name || '')}${s.email ? `<small>${escHtml(s.email)}</small>` : ''}</td>
      <td>${escHtml(s.projekt || '—')}</td>
      <td>${escHtml(s.titel || '—')}</td>
      <td class="amount">${betrag}</td>
      <td>${escHtml(bezahlt || '—')}</td>
      <td class="iban">${escHtml(s.iban || '—')}</td>
      <td>${belegLk}</td>
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

function applyFilters() {
  const search  = document.getElementById('filter-search').value.toLowerCase();
  const projekt = document.getElementById('filter-projekt').value;
  const bezahlt = document.getElementById('filter-bezahlt').value;
  const from    = document.getElementById('filter-from').value;
  const to      = document.getElementById('filter-to').value;

  const filtered = allSubmissions.filter(s => {
    if (search   && !JSON.stringify(s).toLowerCase().includes(search))  return false;
    if (projekt  && s.projekt    !== projekt)                            return false;
    if (bezahlt  && s.bezahlt_via !== bezahlt)                          return false;
    if (from     && s.beleg_datum && s.beleg_datum < from)              return false;
    if (to       && s.beleg_datum && s.beleg_datum > to)                return false;
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
    'Eingereicht am':   s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('de-CH') : '',
    'Name':             s.name         || '',
    'E-Mail':           s.email        || '',
    'Titel':            s.titel        || '',
    'Projekt':          s.projekt      || '',
    'Beleg Datum':      s.beleg_datum  || '',
    'Betrag (CHF)':     s.betrag       != null ? Number(s.betrag) : '',
    'Bezahlt via':      s.bezahlt_via  || '',
    'Debit Card':       s.debit_card   || '',
    'Rechnungsstatus':  s.rechnung_status || '',
    'IBAN':             s.iban         || '',
    'Adresse':          s.adresse      || '',
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
   FORM BUILDER – ANZEIGEN
   ============================================================ */
function loadFormBuilder() {
  if (!formConfig) return;
  renderQuestionsList(formConfig.questions);
}

function renderQuestionsList(questions) {
  const list = document.getElementById('questions-list');

  if (!questions.length) {
    list.innerHTML = '<p style="color:#888;font-size:14px;padding:8px 0">Noch keine Fragen vorhanden. Füge eine hinzu.</p>';
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
    if (q.showIf)   tags.push('Bedingt');

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

  document.getElementById('q-label').value       = q?.label       || '';
  document.getElementById('q-type').value        = q?.type        || 'text';
  document.getElementById('q-placeholder').value = q?.placeholder || q?.hint || '';
  document.getElementById('q-required').checked  = q?.required    || false;
  document.getElementById('q-options').value     = (q?.options || []).join('\n');

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
  const type    = document.getElementById('q-type').value;
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

  const type        = document.getElementById('q-type').value;
  const placeholder = document.getElementById('q-placeholder').value.trim();
  const required    = document.getElementById('q-required').checked;
  const optionsRaw  = document.getElementById('q-options').value.trim();
  const options     = type === 'radio'
    ? optionsRaw.split('\n').map(o => o.trim()).filter(Boolean)
    : undefined;

  if (type === 'radio' && (!options || !options.length)) {
    alert('Bitte mindestens eine Option eingeben.');
    return;
  }

  const showifQ  = document.getElementById('q-showif-question').value;
  const showifV  = document.getElementById('q-showif-value').value.trim();
  const showIf   = (showifQ && showifV) ? { question: showifQ, value: showifV } : undefined;

  const id = editingQuestionIdx !== null
    ? formConfig.questions[editingQuestionIdx].id
    : label.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 25) + '_' + Date.now().toString(36);

  const newQ = {
    id, type, label, required,
    ...(placeholder ? { placeholder } : {}),
    ...(options     ? { options }     : {}),
    ...(showIf      ? { showIf }      : {})
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
    // Willkommen-Formular sofort aktualisieren
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
      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error('Ungültige Struktur');
      }
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
   EINSTELLUNGEN – PASSWORT ÄNDERN
   ============================================================ */
document.getElementById('btn-change-password').addEventListener('click', async () => {
  const newPwd    = document.getElementById('new-password').value;
  const confirm   = document.getElementById('confirm-password').value;
  const statusEl  = document.getElementById('password-status');

  statusEl.classList.add('hidden');

  if (!newPwd || newPwd.length < 8) {
    statusEl.textContent = 'Passwort muss mindestens 8 Zeichen lang sein.';
    statusEl.className   = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }
  if (newPwd !== confirm) {
    statusEl.textContent = 'Passwörter stimmen nicht überein.';
    statusEl.className   = 'msg-error';
    statusEl.classList.remove('hidden');
    return;
  }

  const { error } = await db.auth.updateUser({ password: newPwd });
  if (error) {
    statusEl.textContent = 'Fehler: ' + error.message;
    statusEl.className   = 'msg-error';
  } else {
    statusEl.textContent = '✓ Passwort erfolgreich geändert.';
    statusEl.className   = 'msg-success';
    document.getElementById('new-password').value    = '';
    document.getElementById('confirm-password').value = '';
  }
  statusEl.classList.remove('hidden');
});

/* ============================================================
   EINSTELLUNGEN – DATEN BACKUP
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
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showToast(msg, type = 'success') {
  const toast    = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = `toast ${type}`;
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
