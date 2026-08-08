/* ============================================================
PFADI KRIENS â FINANZEN
app.js â Hauptlogik
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

// SHA-256 of "Mitglieder2026!" â used as fallback if no setting stored yet
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
FORM â LADEN & RENDERN
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
FORM â BRANCHING
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
FORM â EINREICHUNG
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
    showStatus(statusEl, 'Bitte alle Pflichtfelder ausfÃ¼llen.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird eingereichtâ¦';
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
    const eintragText = [formData.titel, formData.name].filter(Boolean).join(' â ') || 'Einreichung';
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

  showStatus(statusEl, 'â Beleg erfolgreich eingereicht! Danke.', 'success');
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
MEMBERS â PASSWORD
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
  document.getElementById('members-ledger-content').innerHTML = '<p class="loading-text">Wird geladenâ¦</p>';
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
MEMBERS â LEDGER DISPLAY
============================================================ */
async function loadLedger(gruppe) {
  const container = document.getElementById('members-ledger-content');
  container.innerHTML = '<p class="loading-text">Wird geladenâ¦</p>';

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
  const salFormatted = (saldo < 0 ? 'â ' : '') + 'CHF ' + Math.abs(saldo).toFixed(2);

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
    html += '<p style="padding:24px;color:#888;font-size:14px;text-align:center">Noch keine EintrÃ¤ge vorhanden.</p>';
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
        ? new Date(r.datum + 'T12:00:00').toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' })¢¢~(	Bs°¢6öç7BVå7G"Ò"æVææÖRòt4br²çVÖ&W""æVææÖRçFôfVB"¢rs°¢6öç7BW57G"Ò"æW6v&Ròt4br²çVÖ&W""æW6v&RçFôfVB"¢rs°¢6öç7B6Å7G"Ò"å÷6ÆFòÂò~(	2r¢rr²t4br²ÖFæ'2"å÷6ÆFòçFôfVB"°¢6öç7B62Ò"å÷6ÆFòâòv6VÆÂ×6ÆFò×÷2r¢"å÷6ÆFòÂòv6VÆÂ×6ÆFòÖæVrr¢v6VÆÂ×6ÆFò×¦W&òs°¢6öç7BÆÂÒ"ç6÷W&6RÓÓÒw7V&Ö76öâròsÇ7â6Æ73Ò'6÷W&6R×ÆÂ#äVç&V6VæsÂ÷7ãâr¢rs° ¢FÖÂ³ÒÇG#à¢ÇFCâG¶W64FÖÂFGVÒÓÂ÷FCà¢ÇFCâG¶W64FÖÂ"çFWBÒG·ÆÇÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶Vå7G"òr6VÆÂÖVææÖRr¢rwÒ#âG¶W64FÖÂVå7G"ÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶W57G"òr6VÆÂÖW6v&Rr¢rwÒ#âG¶W64FÖÂW57G"ÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶W64FÖÂ62Ò#âG¶W64FÖÂ6Å7G"ÓÂ÷FCà¢Â÷G#æ°¢Ò° ¢FÖÂ³ÒsÂ÷F&öGãÂ÷F&ÆSâs°¢Ð ¢FÖÂ³ÒsÂöFcãÂöFcâs°¢6öçFæW"æææW$DÔÂÒFÖÃ°§Ð ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤DÔâ(	2ÄôtâòÄôtõU@£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖÆövâræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7B77v÷&BÒFö7VÖVçBævWDVÆVÖVçD'BvFÖâ×77v÷&BrçfÇVS°¢6öç7BW'&÷$VÂÒFö7VÖVçBævWDVÆVÖVçD'BvÆövâÖW'&÷"r°¢W'&÷$VÂæ6Æ74Æ7BæFBvFFVâr° ¢6öç7B²FFÂW'&÷"ÒÒvBF"æWFç6väåvF77v÷&B²VÖÃ¢DÔåôTÔÂÂ77v÷&BÒ°¢bW'&÷"°¢W'&÷$VÂçFWD6öçFVçBÒtæÖVÆGVærfVÆvW66ÆvVã¢r²W'&÷"æÖW76vS°¢W'&÷$VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢&WGW&ã°¢Ð ¢7W'&VçEW6W"ÒFFçW6W#°¢6÷tFÖäF6&ö&B°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'BvFÖâ×77v÷&BræFDWfVçDÆ7FVæW"v¶WF÷vârÂRÓâ°¢bRæ¶WÓÓÒtVçFW"rFö7VÖVçBævWDVÆVÖVçD'Bv'FâÖÆövâræ6Æ6²°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖÆöv÷WBræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢vBF"æWFç6vä÷WB°¢7W'&VçEW6W"ÒçVÆÃ°¢Fö7VÖVçBævWDVÆVÖVçD'BvFÖâÖÆövâræ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢Fö7VÖVçBævWDVÆVÖVçD'BvFÖâÖF6&ö&Bræ6Æ74Æ7BæFBvFFVâr°§Ò° ¦F"æWFæöäWF7FFT6ævRWfVçBÂ6W76öâÓâ°¢b6W76öãòçW6W"°¢7W'&VçEW6W"Ò6W76öâçW6W#°¢6öç7BfW'rÒFö7VÖVçBævWDVÆVÖVçD'Bw6V2×fW'vÇGVærr°¢bfW'rbbfW'ræ6Æ74Æ7Bæ6öçFç2vFFVâr°¢6÷tFÖäF6&ö&B°¢Ð¢Ð§Ò° ¦gVæ7Föâ6÷tFÖäF6&ö&B°¢Fö7VÖVçBævWDVÆVÖVçD'BvFÖâÖÆövâræ6Æ74Æ7BæFBvFFVâr°¢Fö7VÖVçBævWDVÆVÖVçD'BvFÖâÖF6&ö&Bræ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢ÆöE7V&Ö76öç2°¢ÆöDf÷&Ô'VÆFW"°§Ð ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤DÔâD%0£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBçVW'6VÆV7F÷$ÆÂr6FÖâÖF6&ö&BçF"Ö'Fâræf÷$V6'FâÓâ°¢'FâæFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢Fö7VÖVçBçVW'6VÆV7F÷$ÆÂr6FÖâÖF6&ö&BçF"Ö'Fâræf÷$V6"Óâ"æ6Æ74Æ7Bç&VÖ÷fRv7FfRr°¢Fö7VÖVçBçVW'6VÆV7F÷$ÆÂr6FÖâÖF6&ö&BçF"Ö6öçFVçBræf÷$V6BÓâBæ6Æ74Æ7BæFBvFFVâr°¢'Fâæ6Æ74Æ7BæFBv7FfRr°¢6öç7BF&vWBÒFö7VÖVçBævWDVÆVÖVçD'BwF"Òr²'FâæFF6WBçF"°¢bF&vWBF&vWBæ6Æ74Æ7Bç&VÖ÷fRvFFVâr° ¢b'FâæFF6WBçF"ÓÓÒv¶öçFVâr°¢ÆöD¶öçFVâ7W'&VçD¶öçFVäw'WR°¢Ð¢Ò°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¥5T$Ô54ôå2(	2ÄDTâbå¤TtTà£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦7æ2gVæ7FöâÆöE7V&Ö76öç2°¢6öç7B6öçFæW"ÒFö7VÖVçBævWDVÆVÖVçD'Bw7V&Ö76öç2Ö6öçFæW"r°¢6öçFæW"æææW$DÔÂÒsÇ6Æ73Ò&ÆöFær×FWB#äVç&V6VævVâvW&FVâvVÆFVî(
cÂ÷âs° ¢6öç7B²FFÂW'&÷"ÒÒvBF ¢æg&öÒw7V&Ö76öç2r¢ç6VÆV7Br¢r¢æ÷&FW"w7V&ÖGFVEöBrÂ²66VæFæs¢fÇ6RÒ° ¢bW'&÷"°¢6öçFæW"æææW$DÔÂÒsÇ6Æ73Ò&×6rÖW'&÷"#äfVÆW"&VÒÆFVã¢r²W'&÷"æÖW76vR²sÂ÷âs°¢&WGW&ã°¢Ð ¢ÆÅ7V&Ö76öç2ÒFFÇÂµÓ° ¢6öç7B&ö¦V·G2Ò²ââææWr6WBÆÅ7V&Ö76öç2æÖ2Óâ2ç&ö¦V·BæfÇFW"&ööÆVâÒç6÷'B°¢6öç7B6VÂÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"×&ö¦V·Br°¢6VÂæææW$DÔÂÒsÆ÷FöâfÇVSÒ"#äÆÆR&ö¦V·FSÂö÷Föãâs°¢&ö¦V·G2æf÷$V6Óâ°¢6VÂæææW$DÔÂ³ÒÆ÷FöâfÇVSÒ"G¶W64FÖÂÒ#âG¶W64FÖÂÓÂö÷Föãæ°¢Ò° ¢&VæFW%7V&Ö76öç5F&ÆRÆÅ7V&Ö76öç2°§Ð ¦gVæ7Föâ&VæFW%7V&Ö76öç5F&ÆRFF°¢6öç7B6öçFæW"ÒFö7VÖVçBævWDVÆVÖVçD'Bw7V&Ö76öç2Ö6öçFæW"r° ¢bFFæÆVæwF°¢6öçFæW"æææW$DÔÂÒsÇ7GÆSÒ&6öÆ÷#¢3¶föçB×6¦S£G·FFæs£g#ä¶VæRVç&V6VævVâvVgVæFVâãÂ÷âs°¢&WGW&ã°¢Ð ¢ÆWB&÷w2Òrs°¢FFæf÷$V62Óâ°¢6öç7BFGVÒÒ2ç7V&ÖGFVEö@¢òæWrFFR2ç7V&ÖGFVEöBçFôÆö6ÆTFFU7G&ærvFRÔ4rÂ²F¢s"ÖFvBrÂÖöçF¢s"ÖFvBrÂV#¢vçVÖW&2rÒ¢¢~(	Bs°¢6öç7B&WG&rÒ2æ&WG&rÒçVÆÂòt4br²çVÖ&W"2æ&WG&rçFôfVB"¢~(	Bs°¢6öç7B&W¦ÇBÒ·2æ&W¦ÇE÷fÂ2æFV&Eö6&BÂ2ç&V6çVæu÷7FGW5ÒæfÇFW"&ööÆVâæ¦öâròr°¢6öç7B&VÆVtÆ²Ò2æ&VÆVu÷W&À¢òÆ&VcÒ&¦f67&C§föB"öæ6Æ6³Ò&÷Vä&VÆVrrG·2æGÒrÂrG¶W64FÖÂ2æ&VÆVu÷W&ÂÒr#ì9fffæVãÂöæ ¢¢~(	Bs°¢6öç7BVÖÄ'FâÒ2æVÖÀ¢òÆ&VcÒ&¦f67&C§föB"öæ6Æ6³Ò'6VæDVÖÂrG¶W64FÖÂ2æVÖÂÒrÂrG¶W64FÖÂ2ææÖRÇÂrrÒrÂrG¶W64FÖÂ2çFFVÂÇÂrrÒr"FFÆSÒ$RÔÖÂ6VæFVâ#î)ÈûóÂöæ ¢¢rs° ¢&÷w2³ÒÇG#à¢ÇFCâG¶FGV×ÓÂ÷FCà¢ÇFCâG¶W64FÖÂ2ææÖRÇÂrrÒG·2æVÖÂòÇ6ÖÆÃâG¶W64FÖÂ2æVÖÂÓÂ÷6ÖÆÃæ¢rwÓÂ÷FCà¢ÇFCâG¶W64FÖÂ2ç&ö¦V·BÇÂ~(	BrÓÂ÷FCà¢ÇFCâG¶W64FÖÂ2çFFVÂÇÂ~(	BrÓÂ÷FCà¢ÇFB6Æ73Ò&Ö÷VçB#âG¶&WG&wÓÂ÷FCà¢ÇFCâG¶W64FÖÂ&W¦ÇBÇÂ~(	BrÓÂ÷FCà¢ÇFB6Æ73Ò&&â#âG¶W64FÖÂ2æ&âÇÂ~(	BrÓÂ÷FCà¢ÇFCâG¶&VÆVtÆ·ÓÂ÷FCà¢ÇFCâG¶VÖÄ'FçÓÂ÷FCà¢Â÷G#æ°¢Ò° ¢6öçFæW"æææW$DÔÂÒ ¢ÆFb6Æ73Ò'F&ÆR×w&W"#à¢ÇF&ÆSà¢ÇFVCà¢ÇG#à¢ÇFäVævW&V6CÂ÷Fà¢ÇFäæÖRòRÔÖÃÂ÷Fà¢ÇFå&ö¦V·CÂ÷Fà¢ÇFåFFVÃÂ÷Fà¢ÇFä&WG&sÂ÷Fà¢ÇFä&W¦ÇBfÂ÷Fà¢ÇFä$ãÂ÷Fà¢ÇFä&VÆVsÂ÷Fà¢ÇFäÖÃÂ÷Fà¢Â÷G#à¢Â÷FVCà¢ÇF&öGâG·&÷w7ÓÂ÷F&öGà¢Â÷F&ÆSà¢ÂöFcæ°§Ð ¦7æ2gVæ7Föâ÷Vä&VÆVrBÂF°¢6öç7B²FFÂW'&÷"ÒÒvBF"ç7F÷&vP¢æg&öÒv&VÆVvRr¢æ7&VFU6væVEW&ÂFÂ#° ¢bW'&÷"ÇÂFFòç6væVEW&Â°¢6÷uFö7Bt&VÆVr¶öæçFRæ6Bv\;fffæWBvW&FVâârÂvW'&÷"r°¢&WGW&ã°¢Ð¢væF÷ræ÷VâFFç6væVEW&ÂÂuö&Ææ²r°§Ð ¦gVæ7Föâ6VæDVÖÂVÖÂÂæÖRÂFFVÂ°¢6öç7B7V&¦V7BÒVæ6öFUU$6ö×öæVçBufF·&Vç2fæç¦Vâ(	2r²FFVÂÇÂtVç&V6Værr°¢6öç7B&öGÒVæ6öFUU$6ö×öæVçBtÆÆòr²æÖRÇÂrr²rÅÆåÆâr°¢væF÷ræÆö6Föâæ&VbÒÖÇFó¢G¶VÖÇÓ÷7V&¦V7CÒG·7V&¦V7GÒf&öGÒG¶&öGÖ°§Ð ¦gVæ7FöâÇfÇFW'2°¢6öç7B6V&6ÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"×6V&6rçfÇVRçFôÆ÷vW$66R°¢6öç7B&ö¦V·BÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"×&ö¦V·BrçfÇVS°¢6öç7B&W¦ÇBÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"Ö&W¦ÇBrçfÇVS°¢6öç7Bg&öÒÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"Ög&öÒrçfÇVS°¢6öç7BFòÒFö7VÖVçBævWDVÆVÖVçD'BvfÇFW"×FòrçfÇVS° ¢6öç7BfÇFW&VBÒÆÅ7V&Ö76öç2æfÇFW"2Óâ°¢b6V&6bb¥4ôâç7G&ævg2çFôÆ÷vW$66Rææ6ÇVFW26V&6&WGW&âfÇ6S°¢b&ö¦V·Bbb2ç&ö¦V·BÓÒ&ö¦V·B&WGW&âfÇ6S°¢b&W¦ÇBbb2æ&W¦ÇE÷fÓÒ&W¦ÇB&WGW&âfÇ6S°¢bg&öÒbb2æ&VÆVuöFGVÒbb2æ&VÆVuöFGVÒÂg&öÒ&WGW&âfÇ6S°¢bFòbb2æ&VÆVuöFGVÒbb2æ&VÆVuöFGVÒâFò&WGW&âfÇ6S°¢&WGW&âG'VS°¢Ò° ¢&VæFW%7V&Ö76öç5F&ÆRfÇFW&VB°§Ð ¥²vfÇFW"×6V&6rÂvfÇFW"×&ö¦V·BrÂvfÇFW"Ö&W¦ÇBrÂvfÇFW"Ög&öÒrÂvfÇFW"×FòuÒæf÷$V6BÓâ°¢Fö7VÖVçBævWDVÆVÖVçD'BBòæFDWfVçDÆ7FVæW"vçWBrÂÇfÇFW'2°¢Fö7VÖVçBævWDVÆVÖVçD'BBòæFDWfVçDÆ7FVæW"v6ævRrÂÇfÇFW'2°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖW÷'BÖW6VÂræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢bÆÅ7V&Ö76öç2æÆVæwF°¢6÷uFö7Bt¶VæRVç&V6VævVâ§VÒW÷'FW&VâârÂvW'&÷"r°¢&WGW&ã°¢Ð ¢6öç7B&÷w2ÒÆÅ7V&Ö76öç2æÖ2Óâ°¢tVævW&V6BÒs¢2ç7V&ÖGFVEöBòæWrFFR2ç7V&ÖGFVEöBçFôÆö6ÆTFFU7G&ærvFRÔ4r¢rrÀ¢tæÖRs¢2ææÖRÇÂrrÀ¢tRÔÖÂs¢2æVÖÂÇÂrrÀ¢uFFVÂs¢2çFFVÂÇÂrrÀ¢u&ö¦V·Bs¢2ç&ö¦V·BÇÂrrÀ¢t&VÆVrFGVÒs¢2æ&VÆVuöFGVÒÇÂrrÀ¢t&WG&r4bs¢2æ&WG&rÒçVÆÂòçVÖ&W"2æ&WG&r¢rrÀ¢t&W¦ÇBfs¢2æ&W¦ÇE÷fÇÂrrÀ¢tFV&B6&Bs¢2æFV&Eö6&BÇÂrrÀ¢u&V6çVæw77FGW2s¢2ç&V6çVæu÷7FGW2ÇÂrrÀ¢t$âs¢2æ&âÇÂrrÀ¢tG&W76Rs¢2æG&W76RÇÂrrÀ¢Ò° ¢6öç7Bw2ÒÅ5çWFÇ2æ§6öå÷Fõ÷6VWB&÷w2°¢w5²r6öÇ2uÒÒ°¢·v6£GÒÇ·v6£#ÒÇ·v6£#gÒÇ·v6£#ÒÇ·v6£GÒÇ·v6£ÒÀ¢·v6£'ÒÇ·v6£'ÒÇ·v6£GÒÇ·v6£ÒÇ·v6£#gÒÇ·v6£3'Ð¢Ó° ¢6öç7Bv"ÒÅ5çWFÇ2æ&ööµöæWr°¢Å5çWFÇ2æ&ööµöVæE÷6VWBv"Âw2Ât&VÆVvRr°¢Å5çw&FTfÆRv"Â&VÆVvUõfFô·&Vç5òG¶æWrFFRçFô4õ7G&ærç6Æ6RÃÒçÇ7°¢6÷uFö7BtW6VÂW÷'FW'Br°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤´ôåDTâ(	2DÔâD £ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBçVW'6VÆV7F÷$ÆÂræw'WR×6VÆV7F÷"æw'WRÖ'Fâræf÷$V6'FâÓâ°¢'FâæFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢Fö7VÖVçBçVW'6VÆV7F÷$ÆÂræw'WR×6VÆV7F÷"æw'WRÖ'Fâræf÷$V6"Óâ"æ6Æ74Æ7Bç&VÖ÷fRv7FfRr°¢'Fâæ6Æ74Æ7BæFBv7FfRr°¢7W'&VçD¶öçFVäw'WRÒ'FâæFF6WBæw'WS°¢ÆöD¶öçFVâ7W'&VçD¶öçFVäw'WR°¢Ò°§Ò° ¦7æ2gVæ7FöâÆöD¶öçFVâw'WR°¢6öç7B6öçFæW"ÒFö7VÖVçBævWDVÆVÖVçD'Bv¶öçFVâ×F&ÆRÖ6öçFæW"r°¢6öçFæW"æææW$DÔÂÒsÇ6Æ73Ò&ÆöFær×FWB#åv&BvVÆFVî(
cÂ÷âs° ¢6öç7B²FFÂW'&÷"ÒÒvBF ¢æg&öÒvÆVFvW%öVçG&W2r¢ç6VÆV7Br¢r¢æWvw'WRrÂw'WR¢æ÷&FW"vFGVÒrÂ²66VæFæs¢G'VRÒ¢æ÷&FW"v7&VFVEöBrÂ²66VæFæs¢G'VRÒ° ¢bW'&÷"°¢6öçFæW"æææW$DÔÂÒÇ6Æ73Ò&×6rÖW'&÷"#äfVÆW#¢G¶W64FÖÂW'&÷"æÖW76vRÓÂ÷æ°¢&WGW&ã°¢Ð ¢&VæFW$¶öçFVåF&ÆRw'WRÂFFÇÂµÒ°§Ð ¦gVæ7Föâ&VæFW$¶öçFVåF&ÆRw'WRÂVçG&W2°¢6öç7B6öçFæW"ÒFö7VÖVçBævWDVÆVÖVçD'Bv¶öçFVâ×F&ÆRÖ6öçFæW"r° ¢òò'Vææær6ÆFð¢ÆWB6ÆFòÒ°¢6öç7B&÷w2ÒVçG&W2æÖRÓâ°¢6öç7BVâÒRæVææÖRòçVÖ&W"RæVææÖR¢°¢6öç7BW2ÒRæW6v&RòçVÖ&W"RæW6v&R¢°¢6ÆFò³ÒVâÒW3°¢&WGW&â²ââæRÂ÷6ÆFó¢6ÆFòÓ°¢Ò° ¢6öç7B6Å7G"Ò6ÆFòÂò~(	2r¢rr²t4br²ÖFæ'26ÆFòçFôfVB"°¢6öç7B6Ä6Ç2Ò6ÆFòâòv·2×÷2r¢6ÆFòÂòv·2ÖæVrr¢v·2×¦W&òs° ¢ÆWBFÖÂÒ ¢ÆFb6Æ73Ò&¶öçFVâ×6ÆFò×7G&#à¢Ç7â6Æ73Ò&·2ÖÆ&VÂ#å6ÆFòG¶W64FÖÂw'WRÓÂ÷7ãà¢Ç7â6Æ73Ò&·2×fÇVRG·6Ä6Ç7Ò#âG¶W64FÖÂ6Å7G"ÓÂ÷7ãà¢ÂöFcà¢° ¢b&÷w2æÆVæwF°¢FÖÂ³ÒsÇ7GÆSÒ&6öÆ÷#¢3¶föçB×6¦S£G·FFæs£#äæö6¶VæRVçG,:FvRâ¶Æ6¶R*²²VçG&|+²VÒ§R&VvææVâãÂ÷âs°¢ÒVÇ6R°¢FÖÂ³Ò ¢ÆFb6Æ73Ò&ÆVFvW"×F&ÆR×w&W"#à¢ÇF&ÆR6Æ73Ò&ÆVFvW"#à¢ÇFVCà¢ÇG#à¢ÇFäFGVÓÂ÷Fà¢ÇFåFWCÂ÷Fà¢ÇF6Æ73Ò&çVÒ#äVææÖSÂ÷Fà¢ÇF6Æ73Ò&çVÒ#äW6v&SÂ÷Fà¢ÇF6Æ73Ò&çVÒ#å6ÆFóÂ÷Fà¢ÇFãÂ÷Fà¢Â÷G#à¢Â÷FVCà¢ÇF&öGà¢° ¢&÷w2æf÷$V6"Óâ°¢6öç7BFGVÒÒ"æFGVÐ¢òæWrFFR"æFGVÒ²uC#££rçFôÆö6ÆTFFU7G&ærvFRÔ4rÂ²F¢s"ÖFvBrÂÖöçF¢s"ÖFvBrÂV#¢vçVÖW&2rÒ¢¢~(	Bs°¢6öç7BVå7G"Ò"æVææÖRòt4br²çVÖ&W""æVææÖRçFôfVB"¢rs°¢6öç7BW57G"Ò"æW6v&Ròt4br²çVÖ&W""æW6v&RçFôfVB"¢rs°¢6öç7B%6Å7G"Ò"å÷6ÆFòÂò~(	2r¢rr²t4br²ÖFæ'2"å÷6ÆFòçFôfVB"°¢6öç7B62Ò"å÷6ÆFòâòv6VÆÂ×6ÆFò×÷2r¢"å÷6ÆFòÂòv6VÆÂ×6ÆFòÖæVrr¢v6VÆÂ×6ÆFò×¦W&òs°¢6öç7B57V&Ö76öâÒ"ç6÷W&6RÓÓÒw7V&Ö76öâs°¢6öç7BÆÂÒ57V&Ö76öâòsÇ7â6Æ73Ò'6÷W&6R×ÆÂ#äWFóÂ÷7ãâr¢rs° ¢6öç7B7Föç2Ò57V&Ö76öà¢òÆ'WGFöâ6Æ73Ò&'FâÖ6öâ'FâÖFævW""FFÆSÒ$Î÷66Vâ"öæ6Æ6³Ò&FVÆWFTVçG&rrG·"æGÒr#ï	ùyûóÂö'WGFöãæ ¢¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ"FFÆSÒ$&V&&VFVâ"öæ6Æ6³Ò&VFDVçG&rrG·"æGÒrÂrG¶W64FÖÂ"æFGVÒÇÂrrÒrÂrG¶W64FÖÂ"çFWBÇÂrrÒrÂG·"æVææÖRÇÂÒÂG·"æW6v&RÇÂÒ#î)ÈþûóÂö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ'FâÖFævW""FFÆSÒ$Ì;g66Vâ"öæ6Æ6³Ò&FVÆWFTVçG&rrG·"æGÒr#ï	ùyûóÂö'WGFöãæ° ¢FÖÂ³ÒÇG#à¢ÇFCâG¶W64FÖÂFGVÒÓÂ÷FCà¢ÇFCâG¶W64FÖÂ"çFWBÒG·ÆÇÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶Vå7G"òr6VÆÂÖVææÖRr¢rwÒ#âG¶W64FÖÂVå7G"ÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶W57G"òr6VÆÂÖW6v&Rr¢rwÒ#âG¶W64FÖÂW57G"ÓÂ÷FCà¢ÇFB6Æ73Ò&çVÒG¶W64FÖÂ62Ò#âG¶W64FÖÂ%6Å7G"ÓÂ÷FCà¢ÇFB7GÆSÒ'vFR×76S¦æ÷w&·FWBÖÆvã§&vB#à¢ÆFb6Æ73Ò'VW7FöâÖ7Föç2#âG¶7Föç7ÓÂöFcà¢Â÷FCà¢Â÷G#æ°¢Ò° ¢FÖÂ³ÒsÂ÷F&öGãÂ÷F&ÆSãÂöFcâs°¢Ð ¢6öçFæW"æææW$DÔÂÒFÖÃ°§Ð ¢òò÷VâFBÖöFÀ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖFBÖVçG&rræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢VFFætVçG&tBÒçVÆÃ°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂ×FFÆRrçFWD6öçFVçBÒtVçG&rç§Vl;ÆvVâs°¢Fö7VÖVçBævWDVÆVÖVçD'BvRÖFGVÒrçfÇVRÒæWrFFRçFô4õ7G&ærç6Æ6RÂ°¢Fö7VÖVçBævWDVÆVÖVçD'BvR×FWBrçfÇVRÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'BvRÖ&WG&rrçfÇVRÒrs°¢Fö7VÖVçBçVW'6VÆV7F÷"vçWE¶æÖSÒ&R×G%Õ·fÇVSÒ&W6v&R%Òræ6V6¶VBÒG'VS°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Æræ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢Fö7VÖVçBævWDVÆVÖVçD'BvR×FWBræfö7W2°§Ò° ¢òòVFBâW7FærVçG'¦gVæ7FöâVFDVçG&rBÂFGVÒÂFWBÂVææÖRÂW6v&R°¢VFFætVçG&tBÒC°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂ×FFÆRrçFWD6öçFVçBÒtVçG&r&V&&VFVâs°¢Fö7VÖVçBævWDVÆVÖVçD'BvRÖFGVÒrçfÇVRÒFGVÓ°¢Fö7VÖVçBævWDVÆVÖVçD'BvR×FWBrçfÇVRÒFWC° ¢bVææÖRâ°¢Fö7VÖVçBçVW'6VÆV7F÷"vçWE¶æÖSÒ&R×G%Õ·fÇVSÒ&VææÖR%Òræ6V6¶VBÒG'VS°¢Fö7VÖVçBævWDVÆVÖVçD'BvRÖ&WG&rrçfÇVRÒVææÖS°¢ÒVÇ6R°¢Fö7VÖVçBçVW'6VÆV7F÷"vçWE¶æÖSÒ&R×G%Õ·fÇVSÒ&W6v&R%Òræ6V6¶VBÒG'VS°¢Fö7VÖVçBævWDVÆVÖVçD'BvRÖ&WG&rrçfÇVRÒW6v&S°¢Ð ¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Æræ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢Fö7VÖVçBævWDVÆVÖVçD'BvR×FWBræfö7W2°§Ð ¢òòFVÆWFRâVçG'¦7æ2gVæ7FöâFVÆWFTVçG&rB°¢b6öæf&ÒtVçG&rv&¶Æ6Ì;g66Vãòr&WGW&ã° ¢6öç7B²W'&÷"ÒÒvBF"æg&öÒvÆVFvW%öVçG&W2ræFVÆWFRæWvBrÂB°¢bW'&÷"°¢6÷uFö7BtfVÆW#¢r²W'&÷"æÖW76vRÂvW'&÷"r°¢ÒVÇ6R°¢6÷uFö7BtVçG&rvVÌ;g66Bâr°¢ÆöD¶öçFVâ7W'&VçD¶öçFVäw'WR°¢Ð§Ð ¢òò6fRFB÷"VFB¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖVçG&r×6fRræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7BFGVÒÒFö7VÖVçBævWDVÆVÖVçD'BvRÖFGVÒrçfÇVS°¢6öç7BFWBÒFö7VÖVçBævWDVÆVÖVçD'BvR×FWBrçfÇVRçG&Ò°¢6öç7BGÒFö7VÖVçBçVW'6VÆV7F÷"vçWE¶æÖSÒ&R×G%Ó¦6V6¶VBrçfÇVS°¢6öç7B&WG&u&rÒ'6TfÆöBFö7VÖVçBævWDVÆVÖVçD'BvRÖ&WG&rrçfÇVR° ¢bFGVÒÇÂFWBÇÂ4æâ&WG&u&rÇÂ&WG&u&rÃÒ°¢6÷uFö7Bt&GFRÆÆRfVÆFW"W6l;ÆÆÆVâârÂvW'&÷"r°¢&WGW&ã°¢Ð ¢6öç7BÆöBÒ°¢w'WS¢7W'&VçD¶öçFVäw'WRÀ¢FGVÒÀ¢FWBÀ¢VææÖS¢GÓÓÒvVææÖRrò&WG&u&r¢çVÆÂÀ¢W6v&S¢GÓÓÒvW6v&Rrò&WG&u&r¢çVÆÂÀ¢6÷W&6S¢vÖçVÂp¢Ó° ¢ÆWBW'&÷#°¢bVFFætVçG&tB°¢²W'&÷"ÒÒvBF"æg&öÒvÆVFvW%öVçG&W2rçWFFRÆöBæWvBrÂVFFætVçG&tB°¢ÒVÇ6R°¢²W'&÷"ÒÒvBF"æg&öÒvÆVFvW%öVçG&W2ræç6W'BÆöB°¢Ð ¢bW'&÷"°¢6÷uFö7BtfVÆW#¢r²W'&÷"æÖW76vRÂvW'&÷"r°¢&WGW&ã°¢Ð ¢6÷uFö7BVFFætVçG&tBòtVçG&r·GVÆ6W'Bâr¢tVçG&rvW7V6W'BârÂw7V66W72r°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°¢ÆöD¶öçFVâ7W'&VçD¶öçFVäw'WR°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖVçG&rÖ6æ6VÂræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&ÆræFDWfVçDÆ7FVæW"v6Æ6²rÂRÓâ°¢bRçF&vWBÓÓÒFö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Ær°¢Fö7VÖVçBævWDVÆVÖVçD'BvVçG&rÖÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°¢Ð§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤dõ$Ò%TÄDU"(	2å¤TtTà£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦gVæ7FöâÆöDf÷&Ô'VÆFW"°¢bf÷&Ô6öæfr&WGW&ã°¢&VæFW%VW7Föç4Æ7Bf÷&Ô6öæfrçVW7Föç2°§Ð ¦gVæ7Föâ&VæFW%VW7Föç4Æ7BVW7Föç2°¢6öç7BÆ7BÒFö7VÖVçBævWDVÆVÖVçD'BwVW7Föç2ÖÆ7Br° ¢bVW7Föç2æÆVæwF°¢Æ7BæææW$DÔÂÒsÇ7GÆSÒ&6öÆ÷#¢3¶föçB×6¦S£G·FFæs£#äæö6¶VæRg&vVâf÷&æFVâãÂ÷âs°¢&WGW&ã°¢Ð ¢Æ7BæææW$DÔÂÒrs°¢VW7Föç2æf÷$V6ÂÓâ°¢6öç7BGTÆ&VÂÒ°¢FWC¢uFWBrÂVÖÃ¢tRÔÖÂrÂçVÖ&W#¢u¦ÂrÂFFS¢tFGVÒrÀ¢&Fó¢tW7vÂrÂfÆS¢tFFVp¢Õ·çGUÒÇÂçGS° ¢6öç7BFw2Ò·GTÆ&VÅÓ°¢bç&WV&VBFw2çW6ufÆ6Br°¢bç6÷tbFw2çW6t&VFæwBr° ¢6öç7BFbÒFö7VÖVçBæ7&VFTVÆVÖVçBvFbr°¢Fbæ6Æ74æÖRÒwVW7FöâÖFVÒs°¢FbæææW$DÔÂÒ ¢ÆFb6Æ73Ò'VW7FöâÖæfò#à¢Ç7â6Æ73Ò'ÖæFW#âG¶²ÓÂ÷7ãà¢ÆFcà¢Ç7G&öæsâG¶W64FÖÂæÆ&VÂÓÂ÷7G&öæsà¢Ç6ÖÆÃâG·Fw2æ¦öâr+rrÓÂ÷6ÖÆÃà¢ÂöFcà¢ÂöFcà¢ÆFb6Æ73Ò'VW7FöâÖ7Föç2#à¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ"FFÆSÒ$æ6ö&Vâ"öæ6Æ6³Ò&Ö÷fUVW7FöâG¶ÒÂÓ"G¶ÓÓÒòvF6&ÆVBr¢rwÓî(iÂö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ"FFÆSÒ$æ6VçFVâ"öæ6Æ6³Ò&Ö÷fUVW7FöâG¶ÒÂ"G¶ÓÓÒVW7Föç2æÆVæwFÒòvF6&ÆVBr¢rwÓî(i3Âö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ"FFÆSÒ$&V&&VFVâ"öæ6Æ6³Ò&VFEVW7FöâG¶Ò#î)ÈþûóÂö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'FâÖ6öâ'FâÖFævW""FFÆSÒ$Ì;g66Vâ"öæ6Æ6³Ò&FVÆWFUVW7FöâG¶Ò#ï	ùyûóÂö'WGFöãà¢ÂöFcæ°¢Æ7BæVæD6ÆBFb°¢Ò°§Ð ¦gVæ7FöâÖ÷fUVW7FöâæFWÂF&V7Föâ°¢6öç7B2Òf÷&Ô6öæfrçVW7Föç3°¢6öç7BæWtGÒæFW²F&V7Föã°¢bæWtGÂÇÂæWtGãÒ2æÆVæwF&WGW&ã°¢·5¶æFWÒÂ5¶æWtGÕÒÒ·5¶æWtGÒÂ5¶æFWÕÓ°¢&VæFW%VW7Föç4Æ7B2°§Ð ¦gVæ7FöâFVÆWFUVW7FöâæFW°¢b6öæf&Òg&vR"G¶f÷&Ô6öæfrçVW7Föç5¶æFWÒæÆ&VÇÒ"Ì;g66Vãö&WGW&ã°¢f÷&Ô6öæfrçVW7Föç2ç7Æ6RæFWÂ°¢&VæFW%VW7Föç4Æ7Bf÷&Ô6öæfrçVW7Föç2°§Ð ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤dõ$Ò%TÄDU"(	2ÔôDÀ£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖFB×VW7FöâræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢VFFæuVW7FöäGÒçVÆÃ°¢÷VåVW7FöäÖöFÂçVÆÂ°§Ò° ¦gVæ7FöâVFEVW7FöâæFW°¢VFFæuVW7FöäGÒæFW°¢÷VåVW7FöäÖöFÂf÷&Ô6öæfrçVW7Föç5¶æFWÒ°§Ð ¦gVæ7Föâ÷VåVW7FöäÖöFÂ°¢Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂ×FFÆRrçFWD6öçFVçBÒòtg&vR&V&&VFVâr¢tg&vRç§Vl;ÆvVâs° ¢Fö7VÖVçBævWDVÆVÖVçD'BwÖÆ&VÂrçfÇVRÒòæÆ&VÂÇÂrs°¢Fö7VÖVçBævWDVÆVÖVçD'Bw×GRrçfÇVRÒòçGRÇÂwFWBs°¢Fö7VÖVçBævWDVÆVÖVçD'Bw×Æ6VöÆFW"rçfÇVRÒòçÆ6VöÆFW"ÇÂòæçBÇÂrs°¢Fö7VÖVçBævWDVÆVÖVçD'Bw×&WV&VBræ6V6¶VBÒòç&WV&VBÇÂfÇ6S°¢Fö7VÖVçBævWDVÆVÖVçD'BwÖ÷Föç2rçfÇVRÒòæ÷Föç2ÇÂµÒæ¦öâuÆâr° ¢6öç7B6÷ve6VÂÒFö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×VW7Föâr°¢6÷ve6VÂæææW$DÔÂÒsÆ÷FöâfÇVSÒ"#äÖÖW"ç¦VvVãÂö÷Föãâs°¢f÷&Ô6öæfrçVW7Föç2æf÷$V6gÓâ°¢bgçGRÓÒw&Fòr&WGW&ã°¢6öç7B6VÆV7FVBÒòç6÷tcòçVW7FöâÓÓÒgæBòw6VÆV7FVBr¢rs°¢6÷ve6VÂæææW$DÔÂ³ÒÆ÷FöâfÇVSÒ"G¶gæGÒ"G·6VÆV7FVGÓâG¶W64FÖÂgæÆ&VÂÓÂö÷Föãæ°¢Ò° ¢Fö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×fÇVRrçfÇVRÒòç6÷tcòçfÇVRÇÂrs° ¢WFFTÖöFÄFWVæFVçDfVÆG2°¢Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&Æræ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢Fö7VÖVçBævWDVÆVÖVçD'BwÖÆ&VÂræfö7W2°§Ð ¦gVæ7FöâWFFTÖöFÄFWVæFVçDfVÆG2°¢6öç7BGRÒFö7VÖVçBævWDVÆVÖVçD'Bw×GRrçfÇVS°¢6öç7B6÷veÒFö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×VW7FöârçfÇVS° ¢Fö7VÖVçBævWDVÆVÖVçD'BwÖ÷Föç2Öw&÷Wr¢æ6Æ74Æ7BçFövvÆRvFFVârÂGRÓÒw&Fòr°¢Fö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×fÇVRr¢æ6Æ74Æ7BçFövvÆRvFFVârÂ6÷ve°§Ð ¦Fö7VÖVçBævWDVÆVÖVçD'Bw×GRræFDWfVçDÆ7FVæW"v6ævRrÂWFFTÖöFÄFWVæFVçDfVÆG2°¦Fö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×VW7FöâræFDWfVçDÆ7FVæW"v6ævRrÂWFFTÖöFÄFWVæFVçDfVÆG2° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖÖöFÂÖ6æ6VÂræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&ÆræFDWfVçDÆ7FVæW"v6Æ6²rÂRÓâ°¢bRçF&vWBÓÓÒFö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&Ær°¢Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°¢Ð§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖÖöFÂ×6fRræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢6öç7BÆ&VÂÒFö7VÖVçBævWDVÆVÖVçD'BwÖÆ&VÂrçfÇVRçG&Ò°¢bÆ&VÂ²ÆW'Bt&GFRVæVâg&vWFWBVævV&Vââr²&WGW&ã²Ð ¢6öç7BGRÒFö7VÖVçBævWDVÆVÖVçD'Bw×GRrçfÇVS°¢6öç7BÆ6VöÆFW"ÒFö7VÖVçBævWDVÆVÖVçD'Bw×Æ6VöÆFW"rçfÇVRçG&Ò°¢6öç7B&WV&VBÒFö7VÖVçBævWDVÆVÖVçD'Bw×&WV&VBræ6V6¶VC°¢6öç7B÷Föç5&rÒFö7VÖVçBævWDVÆVÖVçD'BwÖ÷Föç2rçfÇVRçG&Ò°¢6öç7B÷Föç2ÒGRÓÓÒw&Fòp¢ò÷Föç5&rç7ÆBuÆâræÖòÓâòçG&ÒæfÇFW"&ööÆVâ¢¢VæFVfæVC° ¢bGRÓÓÒw&Fòrbb÷Föç2ÇÂ÷Föç2æÆVæwF°¢ÆW'Bt&GFRÖæFW7FVç2VæR÷FöâVævV&Vââr°¢&WGW&ã°¢Ð ¢6öç7B6÷veÒFö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×VW7FöârçfÇVS°¢6öç7B6÷vebÒFö7VÖVçBævWDVÆVÖVçD'Bw×6÷vb×fÇVRrçfÇVRçG&Ò°¢6öç7B6÷tbÒ6÷vebb6÷vebò²VW7Föã¢6÷veÂfÇVS¢6÷vebÒ¢VæFVfæVC° ¢6öç7BBÒVFFæuVW7FöäGÓÒçVÆÀ¢òf÷&Ô6öæfrçVW7Föç5¶VFFæuVW7FöäGÒæ@¢¢Æ&VÂçFôÆ÷vW$66Rç&WÆ6Rõµæ×£ÓÒörÂuòrç&WÆ6Rõò²örÂuòrç7V'7G&ærÂ#R²uòr²FFRææ÷rçFõ7G&ær3b° ¢6öç7BæWuÒ°¢BÂGRÂÆ&VÂÂ&WV&VBÀ¢âââÆ6VöÆFW"ò²Æ6VöÆFW"Ò¢·ÒÀ¢âââ÷Föç2ò²÷Föç2Ò¢·ÒÀ¢âââ6÷tbò²6÷tbÒ¢·Ò¢Ó° ¢bVFFæuVW7FöäGÓÒçVÆÂ°¢f÷&Ô6öæfrçVW7Föç5¶VFFæuVW7FöäGÒÒæWu°¢ÒVÇ6R°¢f÷&Ô6öæfrçVW7Föç2çW6æWu°¢Ð ¢&VæFW%VW7Föç4Æ7Bf÷&Ô6öæfrçVW7Föç2°¢Fö7VÖVçBævWDVÆVÖVçD'BvÖöFÂÖ÷fW&Æræ6Æ74Æ7BæFBvFFVâr°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤dõ$Ò%TÄDU"(	25T4U$âò¥4ôâ$4µU £ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'Fâ×6fRÖf÷&ÒræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7B²W'&÷"ÒÒvBF ¢æg&öÒvf÷&Õö6öæfrr¢çWFFR²6öæfs¢f÷&Ô6öæfrÂWFFVEöC¢æWrFFRçFô4õ7G&ærÒ¢æWvBrÂ° ¢bW'&÷"°¢6÷uFö7BtfVÆW"&VÒ7V6W&ã¢r²W'&÷"æÖW76vRÂvW'&÷"r°¢ÒVÇ6R°¢6÷uFö7Btf÷&×VÆ"vW7V6W'BrÂw7V66W72r°¢&VæFW$f÷&Òf÷&Ô6öæfr°¢Ð§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖF÷væÆöBÖ§6öâræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢F÷væÆöD§6öâf÷&Ô6öæfrÂf÷&Õö6öæfuòG¶æWrFFRçFô4õ7G&ærç6Æ6RÃÒæ§6öæ°¢6÷uFö7Bt¥4ôâ&6·WW'VçFW&vVÆFVââr°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'Fâ×WÆöBÖ§6öâræFDWfVçDÆ7FVæW"v6ævRrÂRÓâ°¢6öç7BfÆRÒRçF&vWBæfÆW5³Ó°¢bfÆR&WGW&ã°¢6öç7B&VFW"ÒæWrfÆU&VFW"°¢&VFW"æöæÆöBÒWbÓâ°¢G'°¢6öç7B'6VBÒ¥4ôâç'6RWbçF&vWBç&W7VÇB°¢b'6VBçVW7Föç2ÇÂ'&æ4'&'6VBçVW7Föç2F&÷ræWrW'&÷"uVæ|;ÆÇFvR7G'V·GW"r°¢f÷&Ô6öæfrÒ'6VC°¢&VæFW%VW7Föç4Æ7Bf÷&Ô6öæfrçVW7Föç2°¢6÷uFö7Bt¥4ôâvVÆFVââ¶Æ6¶R%7V6W&â"VÒ§R;Æ&W&æVÖVââr°¢Ò6F6°¢6÷uFö7BuVæ|;ÆÇFvR¥4ôâÔFFVârÂvW'&÷"r°¢Ð¢Ó°¢&VFW"ç&VD5FWBfÆR°¢RçF&vWBçfÇVRÒrs°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤Tå5DTÄÅTätTâ(	2DÔâ55tõ%@£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖ6ævR×77v÷&BræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7BæWuvBÒFö7VÖVçBævWDVÆVÖVçD'BvæWr×77v÷&BrçfÇVS°¢6öç7B6öæf&ÒÒFö7VÖVçBævWDVÆVÖVçD'Bv6öæf&Ò×77v÷&BrçfÇVS°¢6öç7B7FGW4VÂÒFö7VÖVçBævWDVÆVÖVçD'Bw77v÷&B×7FGW2r° ¢7FGW4VÂæ6Æ74Æ7BæFBvFFVâr° ¢bæWuvBÇÂæWuvBæÆVæwFÂ°¢7FGW4VÂçFWD6öçFVçBÒu77v÷'B×W72ÖæFW7FVç2¦V6VâÆær6Vââs°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢&WGW&ã°¢Ð¢bæWuvBÓÒ6öæf&Ò°¢7FGW4VÂçFWD6öçFVçBÒu77|;g'FW"7FÖÖVâæ6B;Æ&W&Vââs°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢&WGW&ã°¢Ð ¢6öç7B²W'&÷"ÒÒvBF"æWFçWFFUW6W"²77v÷&C¢æWuvBÒ°¢bW'&÷"°¢7FGW4VÂçFWD6öçFVçBÒtfVÆW#¢r²W'&÷"æÖW76vS°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢ÒVÇ6R°¢7FGW4VÂçFWD6öçFVçBÒ~)É2FÖâÕ77v÷'BW&föÆw&V6v\:FæFW'Bâs°¢7FGW4VÂæ6Æ74æÖRÒv×6r×7V66W72s°¢Fö7VÖVçBævWDVÆVÖVçD'BvæWr×77v÷&BrçfÇVRÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'Bv6öæf&Ò×77v÷&BrçfÇVRÒrs°¢Ð¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤Tå5DTÄÅTätTâ(	2ÔTÔ$U%255tõ%@£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖ6ævRÖÖVÖ&W'2×77v÷&BræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7BæWuvBÒFö7VÖVçBævWDVÆVÖVçD'BvæWrÖÖVÖ&W'2×77v÷&BrçfÇVS°¢6öç7B6öæf&ÒÒFö7VÖVçBævWDVÆVÖVçD'Bv6öæf&ÒÖÖVÖ&W'2×77v÷&BrçfÇVS°¢6öç7B7FGW4VÂÒFö7VÖVçBævWDVÆVÖVçD'BvÖVÖ&W'2×77v÷&B×7FGW2r° ¢7FGW4VÂæ6Æ74Æ7BæFBvFFVâr° ¢bæWuvBÇÂæWuvBæÆVæwFÂb°¢7FGW4VÂçFWD6öçFVçBÒu77v÷'B×W72ÖæFW7FVç2b¦V6VâÆær6Vââs°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢&WGW&ã°¢Ð¢bæWuvBÓÒ6öæf&Ò°¢7FGW4VÂçFWD6öçFVçBÒu77|;g'FW"7FÖÖVâæ6B;Æ&W&Vââs°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°¢&WGW&ã°¢Ð ¢6öç7B6ÒvB6#SbæWuvB°¢6öç7B²W'&÷"ÒÒvBF ¢æg&öÒw6WGFæw2r¢çW6W'B²¶W¢vÖVÖ&W'5÷77v÷&Eö6rÂfÇVS¢6ÂWFFVEöC¢æWrFFRçFô4õ7G&ærÒ° ¢bW'&÷"°¢7FGW4VÂçFWD6öçFVçBÒtfVÆW#¢r²W'&÷"æÖW76vS°¢7FGW4VÂæ6Æ74æÖRÒv×6rÖW'&÷"s°¢ÒVÇ6R°¢7FGW4VÂçFWD6öçFVçBÒ~)É2ÖVÖ&W'2Õ77v÷'BW&föÆw&V6v\:FæFW'Bâs°¢7FGW4VÂæ6Æ74æÖRÒv×6r×7V66W72s°¢Fö7VÖVçBævWDVÆVÖVçD'BvæWrÖÖVÖ&W'2×77v÷&BrçfÇVRÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'Bv6öæf&ÒÖÖVÖ&W'2×77v÷&BrçfÇVRÒrs°¢Ð¢7FGW4VÂæ6Æ74Æ7Bç&VÖ÷fRvFFVâr°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤Tå5DTÄÅTätTâ(	2$4µU £ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖ&6·WÖ6öæfrræFDWfVçDÆ7FVæW"v6Æ6²rÂÓâ°¢bf÷&Ô6öæfr²6÷uFö7Bt¶Vâf÷&×VÆ"vVÆFVâârÂvW'&÷"r²&WGW&ã²Ð¢F÷væÆöD§6öâf÷&Ô6öæfrÂf÷&Õö6öæfuòG¶æWrFFRçFô4õ7G&ærç6Æ6RÃÒæ§6öæ°¢6÷uFö7Btf÷&×VÆ"Ô&6·WW'VçFW&vVÆFVââr°§Ò° ¦Fö7VÖVçBævWDVÆVÖVçD'Bv'FâÖ&6·W×7V&Ö76öç2ræFDWfVçDÆ7FVæW"v6Æ6²rÂ7æ2Óâ°¢6öç7B²FFÂW'&÷"ÒÒvBF ¢æg&öÒw7V&Ö76öç2r¢ç6VÆV7Br¢r¢æ÷&FW"w7V&ÖGFVEöBrÂ²66VæFæs¢fÇ6RÒ° ¢bW'&÷"²6÷uFö7BtfVÆW"&VÒÆFVã¢r²W'&÷"æÖW76vRÂvW'&÷"r²&WGW&ã²Ð¢F÷væÆöD§6öâFFÂVç&V6VævVåòG¶æWrFFRçFô4õ7G&ærç6Æ6RÃÒæ§6öæ°¢6÷uFö7BtVç&V6VævVâÔ&6·WW'VçFW&vVÆFVââr°§Ò° ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤Äe4eTäµDôäTà£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦gVæ7FöâF÷væÆöD§6öâö&¢ÂfÆVæÖR°¢6öç7B&Æö"ÒæWr&Æö"´¥4ôâç7G&ævgö&¢ÂçVÆÂÂ"ÒÂ²GS¢vÆ6Föâö§6öârÒ°¢6öç7BÒFö7VÖVçBæ7&VFTVÆVÖVçBvr°¢æ&VbÒU$Âæ7&VFTö&¦V7EU$Â&Æö"°¢æF÷væÆöBÒfÆVæÖS°¢æ6Æ6²°¢U$Âç&Wfö¶Tö&¦V7EU$Âæ&Vb°§Ð ¦gVæ7Föâ6÷uFö7B×6rÂGRÒw7V66W72r°¢6öç7BFö7BÒFö7VÖVçBævWDVÆVÖVçD'BwFö7Br°¢Fö7BçFWD6öçFVçBÒ×6s°¢Fö7Bæ6Æ74æÖRÒFö7BG·GWÖ°¢6ÆV%FÖV÷WBFö7Bå÷FÖV÷WB°¢Fö7Bå÷FÖV÷WBÒ6WEFÖV÷WBÓâFö7Bæ6Æ74Æ7BæFBvFFVârÂ3S°§Ð ¦gVæ7FöâW64FÖÂ7G"°¢b7G"&WGW&ârs°¢&WGW&â7G&ær7G"¢ç&WÆ6RòbörÂrf×²r¢ç&WÆ6RóÂörÂrfÇC²r¢ç&WÆ6RóâörÂrfwC²r¢ç&WÆ6Rò"örÂrgV÷C²r°§Ð ¢ò¢ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¤äDÄ4U%Täp£ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ¢ð¦ÆöDf÷&Ò°
