/* Overlap Admin – client-side helpers */

// ── Toast notifications ──────────────────────────────────────────────────────

function toast(msg, type = 'ok') {
  const c = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();

  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'warn' ? ' toast-warn' : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

// ── Calendar diagnostics ─────────────────────────────────────────────────────

async function testCalendar(url, panelEl) {
  if (!url) { toast('Please enter a URL', 'warn'); return; }

  panelEl.style.display = 'block';
  panelEl.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:.85rem;"><div class="spinner"></div> Fetching calendar…</div>';

  try {
    const resp = await fetch('api.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'action=test_calendar&url=' + encodeURIComponent(url),
    });
    const data = await resp.json();
    renderDiagnostics(panelEl, data);
  } catch (e) {
    panelEl.innerHTML = '<div class="alert alert-error">Connection error: ' + e.message + '</div>';
  }
}

function renderDiagnostics(el, d) {
  if (d.error) {
    el.innerHTML = `<div class="alert alert-error">${esc(d.message || 'Onbekende fout')}</div>`;
    return;
  }

  const s = d.stats || {};
  const rows = [
    ['Status',       '<span class="badge badge-green">OK</span>'],
    ['Fetch time',   d.ms + ' ms &nbsp;·&nbsp; ' + formatBytes(d.bytes)],
    ['Total events', d.eventCount],
    ['Date range',   s.earliest && s.latest ? (s.earliest + ' → ' + s.latest) : '–'],
    ['Upcoming',     s.upcoming ?? '–'],
    ['Past',         s.past ?? '–'],
  ];

  let html = '<div class="diag-panel">';
  for (const [label, val] of rows) {
    html += `<div class="diag-row"><span class="diag-label">${label}</span><span>${val}</span></div>`;
  }

  if (s.samples && s.samples.length) {
    html += '<div class="diag-row"><span class="diag-label">Voorbeelden</span><div class="diag-samples">';
    s.samples.forEach(t => { html += `<span class="diag-sample">${esc(t)}</span>`; });
    html += '</div></div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// ── Crew / volunteer list ────────────────────────────────────────────────────

let crewRowIndex = 0;

function addCrewRow(name = '', color = '#52b788', bday = '') {
  const tbody = document.getElementById('crewTbody');
  if (!tbody) return;

  const idx = crewRowIndex++;
  const tr  = document.createElement('tr');
  tr.className = 'crew-data-row';
  tr.dataset.idx = idx;

  tr.innerHTML = `
    <td><input type="text"  name="crew[${idx}][name]"  value="${esc(name)}"  required placeholder="Name" style="width:100%"></td>
    <td>
      <div style="display:flex;align-items:center;gap:6px;">
        <input type="color" name="crew[${idx}][color]" value="${esc(color)}" style="width:48px;height:32px;padding:2px">
        <input type="text"  name="crew[${idx}][color_text]" value="${esc(color)}" maxlength="7" placeholder="#rrggbb"
               style="width:80px;font-family:monospace;font-size:.8rem" oninput="syncColorText(this)">
      </div>
    </td>
    <td><input type="text"  name="crew[${idx}][bday]"  value="${esc(bday)}"  placeholder="DD-MM" maxlength="5" style="width:80px"></td>
    <td>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="moveRow(this,-1)" title="Omhoog">↑</button>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="moveRow(this,1)"  title="Omlaag">↓</button>
    </td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="removeRow(this)">✕</button></td>`;

  // Sync color picker ↔ text
  const picker = tr.querySelector('input[type=color]');
  const text   = tr.querySelector('input[name$="[color_text]"]');
  picker.addEventListener('input', () => { text.value = picker.value; });

  tbody.appendChild(tr);
}

function syncColorText(input) {
  if (/^#[0-9a-fA-F]{6}$/.test(input.value)) {
    const picker = input.previousElementSibling;
    if (picker) picker.value = input.value;
  }
}

function removeRow(btn) {
  btn.closest('tr').remove();
}

function moveRow(btn, dir) {
  const tr  = btn.closest('tr');
  const tbl = tr.parentElement;
  if (dir === -1 && tr.previousElementSibling) {
    tbl.insertBefore(tr, tr.previousElementSibling);
  } else if (dir === 1 && tr.nextElementSibling) {
    tbl.insertBefore(tr.nextElementSibling, tr);
  }
}

// ── Keyword tags ─────────────────────────────────────────────────────────────

function addKeyword(value = '') {
  const container = document.getElementById('keywordList');
  if (!container) return;
  const idx = container.querySelectorAll('.kw-tag').length;
  const tag = document.createElement('div');
  tag.className = 'kw-tag';
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#e8f4ee;border:1px solid #c0dac8;border-radius:5px;padding:3px 8px;margin:3px;';
  tag.innerHTML = `<input type="text" name="filterKeywords[]" value="${esc(value)}"
      style="border:none;background:transparent;font-size:.83rem;width:140px;outline:none">
    <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#c44;font-size:.85rem;padding:0 2px">✕</button>`;
  container.appendChild(tag);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(b) {
  if (!b) return '–';
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// Confirm destructive actions
document.addEventListener('click', e => {
  const el = e.target.closest('[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) {
    e.preventDefault();
    e.stopPropagation();
  }
});
