<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';

$pageTitle  = 'Schedule';
$activePage = 'schedule';

$flash     = null;
$flashType = 'success';

// ── Save ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['_action'] ?? '') === 'save') {
    try {
        $cfg = Config::read();
        $d   = &$cfg['defaults'];

        // Week start day: 0=Sunday, 1=Monday
        $d['weekStartDay'] = (int)($_POST['weekStartDay'] ?? 1) === 0 ? 0 : 1;

        // Always-show days: checkboxes → array of ints 0-6
        $days = [];
        for ($i = 0; $i <= 6; $i++) {
            if (!empty($_POST['showDay'][$i])) {
                $days[] = $i;
            }
        }
        $d['alwaysShowDays'] = $days;

        // Important dates: [{date, endDate?, label}, ...]
        $rawDates    = $_POST['importantDate']    ?? [];
        $rawEndDates = $_POST['importantEndDate'] ?? [];
        $rawLabels   = $_POST['importantLabel']   ?? [];
        $dates = [];
        foreach ($rawDates as $k => $date) {
            $date    = trim($date);
            $endDate = trim($rawEndDates[$k] ?? '');
            $label   = trim($rawLabels[$k]   ?? '');
            // Strip common Dutch calendar category prefixes (e.g. "Schoolvakantie: ", "Nationale feestdag: ")
            $label   = preg_replace('/^(?:Schoolvakantie|Nationale feestdag|Feestdag|Vakantie|Bijzondere dag|Holiday)\s*:\s*/iu', '', $label);
            $label   = trim($label);
            if (!$date || !$label || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) continue;
            $entry = ['date' => $date, 'label' => $label];
            if ($endDate && preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate) && $endDate > $date) {
                $entry['endDate'] = $endDate;
            }
            $dates[] = $entry;
        }
        usort($dates, fn($a, $b) => strcmp($a['date'], $b['date']));
        $d['importantDates'] = $dates;

        Config::write($cfg);
        $flash = 'Schedule settings saved.';
    } catch (Throwable $e) {
        $flash     = 'Error saving: ' . $e->getMessage();
        $flashType = 'error';
    }
}

try {
    $cfg      = Config::read();
    $loadError = null;
} catch (Throwable $e) {
    $cfg      = [];
    $loadError = $e->getMessage();
}

$d              = $cfg['defaults'] ?? [];
$weekStartDay   = $d['weekStartDay']   ?? 1;                  // 1=Monday default
$alwaysShowDays = $d['alwaysShowDays'] ?? [0, 1, 3, 4, 5, 6]; // default: all except Tuesday
$importantDates = $d['importantDates'] ?? [];

$dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
$dayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

include '_header.php';
?>
<style>
/* ── Important dates: mobile card layout ── */
@media (max-width: 640px) {
  #datesTable thead { display: none; }
  #datesTable,#datesTable tbody { display: block; }
  #datesTable tbody tr {
    display: grid;
    grid-template-columns: 1fr 1fr 36px;
    grid-template-rows: auto auto;
    gap: 4px 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  #datesTable td { display: block; padding: 0; border: none; background: none; }
  #datesTable td:nth-child(1) { grid-column: 1 / 3; grid-row: 1; } /* Label */
  #datesTable td:nth-child(2) { grid-column: 1;     grid-row: 2; } /* From */
  #datesTable td:nth-child(3) { grid-column: 2;     grid-row: 2; } /* Until */
  #datesTable td:nth-child(4) { grid-column: 3;     grid-row: 1; display: flex; align-items: center; }
  #datesTable td input[type=date] { font-size: .72rem; padding: 3px 4px; }
  #datesTable td input[type=text] { font-size: .8rem; }
}
</style>

<div class="page-header">
  <div>
    <h2>Schedule</h2>
    <p>Day visibility and important dates shown in the calendar</p>
  </div>
</div>

<div class="page-body">

<?php if ($loadError): ?>
<div class="alert alert-error"><strong>Config error:</strong> <?= htmlspecialchars($loadError) ?></div>
<?php endif; ?>

<?php if ($flash): ?>
<div class="alert alert-<?= $flashType === 'error' ? 'error' : 'success' ?>"><?= htmlspecialchars($flash) ?></div>
<?php endif; ?>

<form method="POST">
  <input type="hidden" name="_action" value="save">

  <!-- Week start -->
  <div class="card">
    <div class="card-header">
      <div>
        <h3>Week starts on</h3>
        <p style="font-size:.78rem;color:var(--muted);margin-top:2px">
          Controls which day appears first in the week view.
        </p>
      </div>
    </div>
    <div class="card-body">
      <div style="display:flex;gap:12px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                      background:<?= $weekStartDay === 0 ? '#e8f4ee' : '#f4f6f4' ?>;
                      border:2px solid <?= $weekStartDay === 0 ? 'var(--accent)' : 'var(--border)' ?>;
                      border-radius:8px;padding:10px 20px;font-weight:600;transition:.15s"
               id="wsdSun">
          <input type="radio" name="weekStartDay" value="0" <?= $weekStartDay === 0 ? 'checked' : '' ?>
                 style="display:none" onchange="highlightWsd()">
          Sunday
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                      background:<?= $weekStartDay === 1 ? '#e8f4ee' : '#f4f6f4' ?>;
                      border:2px solid <?= $weekStartDay === 1 ? 'var(--accent)' : 'var(--border)' ?>;
                      border-radius:8px;padding:10px 20px;font-weight:600;transition:.15s"
               id="wsdMon">
          <input type="radio" name="weekStartDay" value="1" <?= $weekStartDay === 1 ? 'checked' : '' ?>
                 style="display:none" onchange="highlightWsd()">
          Monday
        </label>
      </div>
    </div>
  </div>

  <!-- Always show days -->
  <div class="card">
    <div class="card-header">
      <div>
        <h3>Always show these days</h3>
        <p style="font-size:.78rem;color:var(--muted);margin-top:2px">
          Checked days are always visible in the week view. Unchecked days are hidden when they have no scheduled events.
        </p>
      </div>
    </div>
    <div class="card-body">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <?php for ($i = 0; $i <= 6; $i++): ?>
        <?php $checked = in_array($i, $alwaysShowDays, true); ?>
        <label style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;
                      background:<?= $checked ? '#e8f4ee' : '#f4f6f4' ?>;
                      border:2px solid <?= $checked ? 'var(--accent)' : 'var(--border)' ?>;
                      border-radius:8px;padding:10px 16px;min-width:70px;transition:.15s"
               id="dayLabel<?= $i ?>"
               onclick="toggleDayCard(this,<?= $i ?>)">
          <input type="checkbox" name="showDay[<?= $i ?>]" value="1"
                 <?= $checked ? 'checked' : '' ?>
                 style="display:none" id="showDay<?= $i ?>">
          <span style="font-weight:700;font-size:.88rem"><?= $dayShort[$i] ?></span>
          <span style="font-size:.72rem;color:var(--muted)"><?= $dayNames[$i] ?></span>
          <span id="dayMark<?= $i ?>" style="font-size:.8rem"><?= $checked ? '✓' : '–' ?></span>
        </label>
        <?php endfor; ?>
      </div>
      <p style="margin-top:12px;font-size:.78rem;color:var(--muted)">
        <strong>Note:</strong> Currently the calendar engine specifically handles Tuesday visibility.
        Other conditional days will be fully supported in a future overlap.js update.
      </p>
    </div>
  </div>

  <!-- Important dates -->
  <div class="card">
    <div class="card-header">
      <div>
        <h3>Important dates</h3>
        <p style="font-size:.78rem;color:var(--muted);margin-top:2px">
          Holidays, school vacations and other notable dates shown as a label on calendar days.
          Leave <em>End date</em> empty for a single day.
        </p>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('icsFile').click()">
          ↑ Import ICS
        </button>
        <input type="file" id="icsFile" accept=".ics,text/calendar" style="display:none" onchange="importICS(this)">
        <span id="icsStatus" style="font-size:.75rem;color:var(--muted)"></span>
      </div>
    </div>
    <div class="card-body" style="padding:0">
      <table class="data-table" id="datesTable">
        <thead>
          <tr>
            <th>Label</th>
            <th style="width:136px">From</th>
            <th style="width:136px">Until (optional)</th>
            <th style="width:44px"></th>
          </tr>
        </thead>
        <tbody id="datesTbody">
          <?php foreach ($importantDates as $entry): ?>
          <tr>
            <td><input type="text" name="importantLabel[]"
                       value="<?= htmlspecialchars($entry['label']) ?>"
                       placeholder="Label" style="width:100%"></td>
            <td><input type="date" name="importantDate[]"
                       value="<?= htmlspecialchars($entry['date']) ?>"
                       style="width:100%" required></td>
            <td><input type="date" name="importantEndDate[]"
                       value="<?= htmlspecialchars($entry['endDate'] ?? '') ?>"
                       style="width:100%"></td>
            <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
          </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
      <div style="padding:12px 16px;border-top:1px solid var(--border)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addDateRow()">+ Add date</button>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:10px;margin-top:4px">
    <button type="submit" class="btn btn-primary">Save</button>
    <a href="index.php" class="btn btn-secondary">Cancel</a>
  </div>

</form>
</div>

<?php include '_footer.php'; ?>

<script>
function highlightWsd() {
  const mon = document.getElementById('wsdMon');
  const sun = document.getElementById('wsdSun');
  const selMon = document.querySelector('input[name=weekStartDay][value="1"]').checked;
  [mon, sun].forEach(el => {
    el.style.background   = '#f4f6f4';
    el.style.borderColor  = 'var(--border)';
  });
  (selMon ? mon : sun).style.background  = '#e8f4ee';
  (selMon ? mon : sun).style.borderColor = 'var(--accent)';
}
// Make the whole label clickable
document.getElementById('wsdMon').addEventListener('click', () => {
  document.querySelector('input[name=weekStartDay][value="1"]').checked = true;
  highlightWsd();
});
document.getElementById('wsdSun').addEventListener('click', () => {
  document.querySelector('input[name=weekStartDay][value="0"]').checked = true;
  highlightWsd();
});

function toggleDayCard(label, idx) {
  const cb   = document.getElementById('showDay' + idx);
  const mark = document.getElementById('dayMark' + idx);
  cb.checked = !cb.checked;
  if (cb.checked) {
    label.style.background     = '#e8f4ee';
    label.style.borderColor    = 'var(--accent)';
    mark.textContent           = '✓';
  } else {
    label.style.background     = '#f4f6f4';
    label.style.borderColor    = 'var(--border)';
    mark.textContent           = '–';
  }
}

function addDateRow(from, until, label) {
  const tbody = document.getElementById('datesTbody');
  const tr    = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" name="importantLabel[]"   placeholder="Label" style="width:100%"></td>
    <td><input type="date" name="importantDate[]"    style="width:100%" required></td>
    <td><input type="date" name="importantEndDate[]" style="width:100%"></td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(tr);
  const inputs = tr.querySelectorAll('input');
  if (label) inputs[0].value = label;
  if (from)  inputs[1].value = from;
  if (until) inputs[2].value = until;
  if (!label) inputs[0].focus();
}

function importICS(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('icsStatus');
  status.textContent = 'Reading…';

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;

    // Unfold lines (RFC 5545: lines ending with CRLF + whitespace are continuations)
    const unfolded = text.replace(/\r?\n[ \t]/g, '');

    // Extract VEVENT blocks
    const events = [];
    const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;
    while ((match = re.exec(unfolded)) !== null) {
      events.push(parseVEvent(match[1]));
    }

    const valid = events.filter(ev => ev.date && ev.label);
    if (!valid.length) {
      status.textContent = 'No usable events found.';
      input.value = '';
      return;
    }

    // Sort by date, then collapse consecutive same-label events into ranges
    valid.sort((a, b) => a.date.localeCompare(b.date));
    const collapsed = collapseRanges(valid);

    collapsed.forEach(ev => addDateRow(ev.date, ev.until, ev.label));

    const orig = valid.length, coll = collapsed.length;
    status.textContent = coll + ' entr' + (coll !== 1 ? 'ies' : 'y') + ' imported'
      + (orig > coll ? ' (' + orig + ' days collapsed into ' + coll + ' range' + (coll !== 1 ? 's' : '') + ')' : '') + '.';
    input.value = '';
    setTimeout(() => { status.textContent = ''; }, 4000);
  };
  reader.readAsText(file);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Merge consecutive events that share the same label into a single date range.
// "Consecutive" means the next event's start date is exactly one day after the current range end.
function collapseRanges(sorted) {
  if (!sorted.length) return [];
  const result = [];
  sorted.forEach(ev => {
    const evEnd = ev.until || ev.date;
    if (result.length) {
      const last    = result[result.length - 1];
      const lastEnd = last.until || last.date;
      if (last.label === ev.label && addDays(lastEnd, 1) === ev.date) {
        // Extend this range
        last.until = evEnd === last.date ? null : evEnd;
        // If the new end is beyond, update it
        if (evEnd > (last.until || last.date)) last.until = evEnd;
        return;
      }
    }
    result.push({ date: ev.date, until: evEnd !== ev.date ? evEnd : null, label: ev.label });
  });
  return result;
}

function parseVEvent(block) {
  function prop(name) {
    // Match PROPNAME or PROPNAME;PARAMS= — value may contain colons
    const m = block.match(new RegExp('^' + name + '(?:;[^:]*)?:(.+)$', 'm'));
    return m ? m[1].trim() : null;
  }

  function icsDateToYMD(raw) {
    if (!raw) return null;
    // Strip TZID or other params already handled by prop(); strip time component
    const dateOnly = raw.replace(/T.*/,'').replace(/[^0-9]/g,'');
    if (dateOnly.length < 8) return null;
    return dateOnly.slice(0,4) + '-' + dateOnly.slice(4,6) + '-' + dateOnly.slice(6,8);
  }

  const startRaw = prop('DTSTART');
  const endRaw   = prop('DTEND');
  const summary  = prop('SUMMARY');

  const startYMD = icsDateToYMD(startRaw);
  let   endYMD   = icsDateToYMD(endRaw);

  // ICS DTEND for all-day events is exclusive (day after last day); subtract one day
  if (endYMD && endRaw && !endRaw.includes('T')) {
    const d = new Date(endYMD + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const p = n => String(n).padStart(2,'0');
    const adj = d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
    endYMD = adj === startYMD ? null : adj; // single day → no end date
  } else if (endYMD === startYMD) {
    endYMD = null;
  }

  return {
    date:  startYMD,
    until: endYMD || null,
    label: summary ? summary.replace(/\\,/g, ',').replace(/\\n/g, ' ').trim() : null,
  };
}
</script>
