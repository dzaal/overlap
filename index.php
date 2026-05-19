<?php
// ── Lightweight update-check endpoint ─────────────────────────────────────────
if (isset($_GET['overlap_upd'])) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $ts = max(
        filemtime(__FILE__),
        is_file(__DIR__.'/app/overlap.js')  ? filemtime(__DIR__.'/app/overlap.js')  : 0,
        is_file(__DIR__.'/app/overlap.css') ? filemtime(__DIR__.'/app/overlap.css') : 0
    );
    echo json_encode(['ts' => $ts]);
    exit;
}

// ── Read branding from config for inline CSS (no JS cache dependency) ─────────
$_themeColor  = '#1a3d2b';
$_fgColor     = '#f8f5ee';
$_accentColor = '#52b788';
$_theme       = 'blockery';
$_logoUrl     = '';
$_appName     = 'Overlap';

$_cfgFile = __DIR__ . '/app/overlap-config.js';
if (file_exists($_cfgFile)) {
    require_once __DIR__ . '/lib/Config.php';
    try {
        $_cfg = Config::read();
        $_b   = $_cfg['branding'] ?? [];
        if (!empty($_b['themeColor']) && preg_match('/^#[0-9a-fA-F]{6}$/i', $_b['themeColor'])) {
            $_themeColor = $_b['themeColor'];
        }
        if (!empty($_b['foregroundColor']) && preg_match('/^#[0-9a-fA-F]{6}$/i', $_b['foregroundColor'])) {
            $_fgColor = $_b['foregroundColor'];
        }
        if (!empty($_b['accentColor']) && preg_match('/^#[0-9a-fA-F]{6}$/i', $_b['accentColor'])) {
            $_accentColor = $_b['accentColor'];
        }
        if (!empty($_b['theme'])) {
            $_themeVal = preg_replace('/[^a-z0-9_-]/i', '', $_b['theme']);
            if ($_themeVal && file_exists(__DIR__ . '/app/' . $_themeVal . '.css')) {
                $_theme = $_themeVal;
            }
        }
        $_logoUrl = $_b['logoUrl'] ?? '';
        $_appName = $_b['appName'] ?? 'Overlap';
    } catch (Throwable $e) { /* keep defaults */ }
}

$_iconUrl   = $_logoUrl ?: 'app/icon-192.png';
$_overlapTs = max(
    filemtime(__FILE__),
    is_file(__DIR__.'/app/overlap.js')  ? filemtime(__DIR__.'/app/overlap.js')  : 0,
    is_file(__DIR__.'/app/overlap.css') ? filemtime(__DIR__.'/app/overlap.css') : 0
);
?><!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($_appName) ?></title>
<meta name="application-name" content="<?= htmlspecialchars($_appName) ?>">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="<?= htmlspecialchars($_appName) ?>">
<meta name="theme-color" content="<?= htmlspecialchars($_themeColor) ?>">
<link rel="manifest" href="app/overlap-manifest.json" id="manifestLink">
<link rel="apple-touch-icon" href="<?= htmlspecialchars($_iconUrl) ?>" id="appleIcon">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="app/overlap.css?v=16">
<?php if ($_theme !== 'blockery' && $_theme !== 'softy'): // blockery+softy styles are in overlap.css ?>
<link rel="stylesheet" href="app/<?= htmlspecialchars($_theme) ?>.css?v=1">
<?php endif; ?>
<style>:root{--gd:<?= htmlspecialchars($_themeColor) ?>;--cr:<?= htmlspecialchars($_fgColor) ?>;--ac:<?= htmlspecialchars($_accentColor) ?>}</style>
</head>
<body class="theme-<?= htmlspecialchars($_theme) ?>">
<header>
  <!-- Hamburger: tablet + mobile -->
  <button class="nb hdr-ham" id="menuBtn" title="Menu">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
  <!-- Brand: logo (appVer injected by overlap.js after .logo) -->
  <div class="hdr-brand">
    <div class="logo">
      <img id="logoImg" src="<?= htmlspecialchars($_iconUrl) ?>" alt="Logo" style="width:36px;height:36px;object-fit:contain;border-radius:8px;">
    </div>
  </div>
  <!-- Navigation: prev + next together -->
  <div class="hdr-arrows">
    <button class="nb" id="pB" title="Vorige (←)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="nb" id="nB" title="Volgende (→)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>
  <!-- Today split button -->
  <div class="tb-split" id="tBGroup">
    <button class="tb tb-main" id="tB">Vandaag</button>
    <button class="tb tb-arrow" id="tBDrop" title="Kies datum">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  </div>
  <!-- Date picker popup -->
  <div id="datePicker" style="display:none">
    <div id="dpHeader">
      <button id="dpPrev">&#8592;</button>
      <span id="dpMonthLabel"></span>
      <button id="dpNext">&#8594;</button>
    </div>
    <div id="dpGrid"></div>
  </div>
  <!-- View toggle: Week | Day (moves to row 2 on mobile) -->
  <div class="vt">
    <button class="vb on" id="bW">Week</button>
    <button class="vb" id="bD">Dag</button>
  </div>
  <!-- Events layer toggle -->
  <div class="layer-toggle">
    <input type="checkbox" id="mainLayerToggle" checked>
    <label for="mainLayerToggle">Events</label>
  </div>
  <!-- Row break: invisible on desktop, forces row 2 on mobile -->
  <div class="hdr-break"></div>
  <!-- Date range (far right on desktop, row 2 on mobile) -->
  <div class="hdr-date-btn" id="hdrDateBtn">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    <span id="pl">…</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  </div>
  <div id="ls">Laden…</div>
  <div id="authBar" class="auth-bar" style="display:none;">
    <div id="loginInfo">Niet ingelogd</div>
    <button id="logoutBtn" class="tb" style="display:none;background:#f8f9fa;color:#1a3d2b;">Uitloggen</button>
    <button id="googleBtn" class="tb" style="display:none;background:#fff;color:#1a3d2b;">Google login</button>
    <span id="googleStatus" style="font-size:.72rem;font-weight:600;margin-left:8px;"></span>
  </div>
</header>

<div id="menuOverlay"></div>

<div id="settingsPanel">
  <div class="stp-head">
    <span>Menu</span>
    <button id="stpClose" title="Sluiten">✕</button>
  </div>

  <!-- Update notice (hidden until JS detects a new version) -->
  <div id="updateNotice" style="display:none" class="stp-section">
    <button class="stp-btn stp-btn-update" onclick="location.reload(true)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      Update beschikbaar — herladen
    </button>
  </div>

  <!-- Install as app (shown by JS when PWA install prompt is available) -->
  <div id="installSection" style="display:none" class="stp-section">
    <button class="stp-btn stp-btn-install" id="installBtn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
      Installeer als app
    </button>
  </div>

  <!-- Print -->
  <div class="stp-section">
    <div class="stp-label">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Afdrukken
    </div>
    <button class="stp-btn" id="printLandBtn">
      <svg width="15" height="11" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="22" height="16" rx="2"/><line x1="1" y1="5" x2="23" y2="5"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="12" x2="15" y2="12"/></svg>
      Liggend (A4 ↔)
    </button>
    <button class="stp-btn" id="printPortOpt">
      <svg width="11" height="15" viewBox="0 0 16 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="14" height="20" rx="2"/><line x1="1" y1="6" x2="15" y2="6"/><line x1="4" y1="10" x2="12" y2="10"/><line x1="4" y1="13" x2="10" y2="13"/></svg>
      Staand (A4 ↕)
    </button>
  </div>

  <!-- Share -->
  <div class="stp-section">
    <div class="stp-label">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Delen
    </div>
    <button class="stp-btn btn-pink" id="shareBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/></svg>
      Deel als afbeelding
    </button>
    <button class="stp-btn" id="shareDrop">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      Kopieer link
    </button>
  </div>

  <!-- Display settings -->
  <div class="stp-section">
    <div class="stp-label">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Instellingen
    </div>
    <div class="stp-label" style="margin-top:0;margin-bottom:6px;opacity:.6">Thema</div>
    <div class="stp-opts" style="margin-bottom:12px">
      <label class="stp-opt"><input type="radio" name="stp-theme" value="blockery"><span>Blockery</span></label>
      <label class="stp-opt"><input type="radio" name="stp-theme" value="softy"><span>Softy</span></label>
      <label class="stp-opt"><input type="radio" name="stp-theme" value="nova"><span>Nova</span></label>
    </div>
    <div class="stp-label" style="margin-top:0;margin-bottom:6px;opacity:.6">Week start op</div>
    <div class="stp-opts">
      <label class="stp-opt"><input type="radio" name="stp-week" value="1"><span>Maandag</span></label>
      <label class="stp-opt"><input type="radio" name="stp-week" value="0"><span>Zondag</span></label>
    </div>
  </div>

  <!-- Auto-refresh interval -->
  <div class="stp-section">
    <div class="stp-label">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      Automatisch vernieuwen
    </div>
    <div class="stp-opts" id="refreshOpts">
      <label class="stp-opt" data-min="5"><span>5 min</span></label>
      <label class="stp-opt" data-min="15"><span>15 min</span></label>
      <label class="stp-opt" data-min="30"><span>30 min</span></label>
      <label class="stp-opt" data-min="60"><span>1 uur</span></label>
      <label class="stp-opt" data-min="0"><span>Uit</span></label>
    </div>
  </div>

  <div class="stp-footer">
    <button id="stpReset">Herstel standaardinstellingen</button>
    <div class="stp-about">
      <div class="stp-about-name">Overlap</div>
      <div class="stp-about-ver" id="stp-ver">v<?= htmlspecialchars(($_cfg['branding']['version'] ?? '1.0')) ?></div>
      <div class="stp-about-meta">
        Door <a href="https://digizaal.net" target="_blank" rel="noopener">Digizaal</a>
        &nbsp;·&nbsp;
        <a href="manage/" target="_blank">Beheer</a>
      </div>
    </div>
  </div>
</div>

<!-- Print submenu (fixed-positioned, stays in body for z-index) -->
<div id="printMenu" style="display:none">
  <button class="print-opt" id="printLandOpt">
    <svg width="16" height="12" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="22" height="16" rx="2"/><line x1="1" y1="5" x2="23" y2="5"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="12" x2="15" y2="12"/></svg>
    Liggend (A4 ↔)
  </button>
  <button class="print-opt" id="printPortOpt2">
    <svg width="11" height="15" viewBox="0 0 16 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="14" height="20" rx="2"/><line x1="1" y1="6" x2="15" y2="6"/><line x1="4" y1="10" x2="12" y2="10"/><line x1="4" y1="13" x2="10" y2="13"/></svg>
    Staand (A4 ↕)
  </button>
</div>

<div id="editorPanel" class="editor-panel" style="display:none;margin:10px;padding:10px;background:#f9f9f8;border:1px solid #d0d0d0;border-radius:10px;max-width:980px;margin-left:auto;margin-right:auto;">
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
    <label style="font-weight:700;font-size:.86rem;">Datum <input type="date" id="newShiftDate" style="margin-left:4px"></label>
    <label style="font-weight:700;font-size:.86rem;">Start <input type="time" id="newShiftStart" style="margin-left:4px"></label>
    <label style="font-weight:700;font-size:.86rem;">Eind <input type="time" id="newShiftEnd" style="margin-left:4px"></label>
    <label style="font-weight:700;font-size:.86rem;">Crew <select id="crewPicker"></select></label>
    <button id="addShiftBtn" class="tb" style="padding:4px 9px;">Voeg dienst toe</button>
  </div>
  <div style="margin-top:8px;font-size:.8rem;color:#333;">Alle wijzigingen worden lokaal opgeslagen in je browser. Alleen ingelogde gebruikers kunnen nieuwe diensten toevoegen.</div>
</div>
<div id="crewLegend" class="crew-legend" style="margin:7px auto 0;max-width:980px;padding:0 8px;font-size:.85rem;display:flex;flex-wrap:wrap;gap:6px;"></div>
<div id="weekStrip"></div>
<div id="printHeader" style="display:none">
  <span class="ph-title"><?= htmlspecialchars($_appName) ?></span>
  <span class="ph-meta" id="printMeta"></span>
</div>
<div id="calOuter"><div id="slidePort"><div id="slideInner"><div id="panelPrev"></div><div id="panelCur" id="panelCur"><div id="skelLoad"></div></div><div id="panelNext"></div></div></div></div>
<div class="tip" id="tip"></div>

<script>window.ROOSTER_NO_AUTH = true; window._overlapTs = <?= $_overlapTs ?>;</script>
<script src="app/overlap-config.js"></script>
<script>
// ── Apply user cookie settings before overlap.js initialises ─────────────────
(function () {
  var m = document.cookie.match(/(?:^|; )overlap_settings=([^;]*)/);
  if (!m) return;
  try {
    var s = JSON.parse(decodeURIComponent(m[1]));
    var cfg = window.OVERLAP_CONFIG || window.ROOSTER_CONFIG;
    if (s.theme) {
      document.body.className = document.body.className.replace(/\btheme-\w+\b/, 'theme-' + s.theme);
    }
    if (s.weekStart !== undefined && cfg && cfg.defaults) {
      cfg.defaults.weekStartDay = +s.weekStart;
    }
    if (s.refreshMin !== undefined) window._overlapRefreshMin = +s.refreshMin;
  } catch (e) {}
})();
</script>
<script src="app/overlap.js?v=120"></script>
<script>
// ── Disable built-in holiday detection ───────────────────────────────────────
// overlap.js has hardcoded Dutch public holidays and Amsterdam school vacations.
// We replace those with the "important dates" system managed in the admin panel.
if (typeof getDutchHolidays === 'function')           getDutchHolidays           = function(y){ return {}; };
if (typeof getAmsterdamSchoolHolidays === 'function') getAmsterdamSchoolHolidays = function(y){ return {}; };

// ── Week start + always-show days ────────────────────────────────────────────
(function () {
  var cfg = window.OVERLAP_CONFIG || window.ROOSTER_CONFIG;
  if (!cfg || !cfg.defaults) return;

  var weekStartDay = cfg.defaults.weekStartDay; // 0=Sun, 1=Mon (default)
  var alwaysShow   = cfg.defaults.alwaysShowDays; // array of day numbers, optional

  // Override sowk() for Sunday-start
  if (weekStartDay === 0 && typeof sowk === 'function') {
    sowk = function (d) {
      var c = new Date(d);
      c.setDate(c.getDate() - c.getDay()); // rewind to Sunday
      c.setHours(0, 0, 0, 0);
      return c;
    };
    // anc was already set via sowk(new Date()) before this override ran — fix it
    // But preserve hash-based navigation: only reset if no valid hash date
    if (!location.hash.match(/^#(week|day)\/\d{4}-\d{2}-\d{2}$/)) {
      anc = sowk(new Date());
    } else if (location.hash.indexOf('#week/') === 0) {
      anc = sowk(anc); // re-apply new Sunday-start sowk to the hash-derived date
    }
    // For #day/ the anc is already a specific date, no sowk needed

    // getWeekNumber uses ISO 8601 (Monday-based). When the first visible day is
    // Sunday, it would land in the previous ISO week. Advance Sunday by 1 day
    // before computing so the label always shows the correct ISO week number.
    if (typeof getWeekNumber === 'function') {
      var _origGWN = getWeekNumber;
      getWeekNumber = function (date) {
        if (date.getDay() === 0) {
          var d = new Date(date);
          d.setDate(d.getDate() + 1);
          return _origGWN(d);
        }
        return _origGWN(date);
      };
    }
  }

  // Override hasTuesdayEvents() to respect alwaysShowDays.
  // Also fixes the offset when week starts on Sunday (anchor+1 would be Mon, not Tue).
  if (typeof hasTuesdayEvents === 'function') {
    var _orig = hasTuesdayEvents;
    hasTuesdayEvents = function (anchorDate) {
      // With Sunday start the original "+1 = Tuesday" arithmetic is off;
      // fall back to always-show logic only.
      if (weekStartDay === 0) {
        return !Array.isArray(alwaysShow) || alwaysShow.indexOf(2) !== -1;
      }
      // Monday start: honour alwaysShowDays if set
      if (Array.isArray(alwaysShow)) {
        if (alwaysShow.indexOf(2) !== -1) return true;  // always show
        return _orig(anchorDate);                        // show only if events
      }
      return _orig(anchorDate);
    };
  }
})();

// ── Important dates ──────────────────────────────────────────────────────────
// Inject labels from config.defaults.importantDates into calendar day headers.
// Supports single days {date, label} and ranges {date, endDate, label}.
(function () {
  var cfg     = window.OVERLAP_CONFIG || window.ROOSTER_CONFIG;
  var entries = cfg && cfg.defaults && cfg.defaults.importantDates;
  if (!Array.isArray(entries) || !entries.length) return;

  function pad(n) { return String(n).padStart(2, '0'); }
  function toKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Build a map: YYYY-MM-DD → label (expand ranges day by day)
  var map = {};
  entries.forEach(function (e) {
    if (!e.date || !e.label) return;
    if (e.endDate && e.endDate > e.date) {
      // Range: fill every day from date to endDate inclusive
      var cur = new Date(e.date + 'T00:00:00');
      var end = new Date(e.endDate + 'T00:00:00');
      while (cur <= end) {
        map[toKey(cur)] = e.label;
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      map[e.date] = e.label;
    }
  });

  function inject() {
    document.querySelectorAll('.ch[data-toggle-day]').forEach(function (el) {
      if (el.dataset.idInjected) return;
      el.dataset.idInjected = '1';
      var d = new Date(el.dataset.toggleDay);
      if (isNaN(d)) return;
      var label = map[toKey(d)];
      if (!label) return;
      var span = document.createElement('span');
      span.className = 'schday';
      span.textContent = '📅 ' + label;
      el.appendChild(span);
    });
  }

  var root = document.getElementById('calOuter');
  if (root) new MutationObserver(inject).observe(root, { childList: true, subtree: true });
  inject();
})();

// ── Day-view: 9:16 portrait width on desktop ─────────────────────────────────
// Width = full available height × (9/16) so the panel looks like a tall portrait
// rectangle. The calendar fills 100 % of the viewport height; if the content is
// taller it scrolls naturally. Mobile (≤ 600 px) keeps full-width behaviour.
(function () {
  if (typeof updateDayViewMetrics !== 'function') return;
  var _orig = updateDayViewMetrics;
  updateDayViewMetrics = function (hourCount, maxCrewCols) {
    _orig(hourCount, maxCrewCols || 1);
    if (vm !== 'day' || window._printMaxCols) return;
    if (window.innerWidth <= 600) return;
    var headerH = (document.querySelector('header') || {}).offsetHeight || 64;
    var stripH  = (document.getElementById('weekStrip') || {}).offsetHeight || 0;
    var usableH = window.innerHeight - headerH - stripH;
    var portrait  = Math.floor(usableH * 9 / 16);
    var cols      = maxCrewCols || window._dayMaxCols || 1;
    var colBased  = 52 + cols * 168;
    var target    = Math.max(portrait, colBased);
    var bounded   = Math.max(320, Math.min(target, window.innerWidth - 40));
    document.body.style.setProperty('--day-view-width', bounded + 'px');
  };
})();

// ── Day-view: week strip navigation ──────────────────────────────────────────
// Shows day chips in day view. updateWeekStrip() is normally only called after
// slide animations; we also trigger it whenever the view-day class is toggled.
(function () {
  function buildDayStrip() {
    var strip = document.getElementById('weekStrip');
    if (!strip) return;

    var today     = new Date(); today.setHours(0, 0, 0, 0);
    var weekStart = sowk(anc);
    var selDate   = new Date(anc); selDate.setHours(0, 0, 0, 0);

    var h = '';
    for (var i = 0; i < 7; i++) {
      var d       = addD(weekStart, i);
      var isSel   = same(d, selDate);
      var isToday = same(d, today);
      var hasEv   = allEv.some(function (ev) {
        var ds = new Date(ev.start); ds.setHours(0, 0, 0, 0);
        return same(ds, d);
      });
      h += '<div class="ws-day' +
           (isSel   ? ' ws-sel'   : '') +
           (isToday ? ' ws-today' : '') +
           '" data-wsd="' + d.toDateString() + '">' +
           '<span class="ws-dn">' + DS[d.getDay()] + '</span>' +
           '<span class="ws-num">' + d.getDate() + '</span>' +
           '<span class="ws-dot' + (hasEv ? ' has-ev' : '') + '"></span>' +
           '</div>';
    }
    strip.innerHTML = h;

    strip.querySelectorAll('[data-wsd]').forEach(function (el) {
      el.addEventListener('click', function () {
        anc = new Date(el.dataset.wsd);
        vm  = 'day';
        document.getElementById('bD').classList.add('on');
        document.getElementById('bW').classList.remove('on');
        render(0);
        // MutationObserver won't fire when already in day view (class unchanged),
        // so rebuild the strip immediately to update the selected-day highlight.
        buildDayStrip();
      });
    });

    // Swipe left/right on the strip to jump to prev/next week
    var _tx = 0;
    strip.addEventListener('touchstart', function (e) {
      _tx = e.touches[0].clientX;
    }, { passive: true });
    strip.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - _tx;
      if (Math.abs(dx) < 40) return;
      anc = addD(new Date(anc), dx < 0 ? 7 : -7);
      render(0);
      buildDayStrip();
    }, { passive: true });
  }

  // Override so slide-animation calls also use the new strip
  if (typeof updateWeekStrip === 'function') {
    var _origStrip = updateWeekStrip;
    updateWeekStrip = function () {
      if (vm === 'day') { buildDayStrip(); return; }
      _origStrip();
    };
  }

  // Also trigger whenever view-day class is added (mode switch without animation)
  new MutationObserver(function () {
    if (document.body.classList.contains('view-day')) {
      setTimeout(buildDayStrip, 0);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();

// ── Settings panel ────────────────────────────────────────────────────────────
(function () {
  var COOKIE = 'overlap_settings';

  function readCookie() {
    var m = document.cookie.match(/(?:^|; )overlap_settings=([^;]*)/);
    try { return m ? JSON.parse(decodeURIComponent(m[1])) : {}; } catch(e) { return {}; }
  }

  function writeCookie(s) {
    var exp = new Date(); exp.setFullYear(exp.getFullYear() + 1);
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(s))
      + ';expires=' + exp.toUTCString() + ';path=/;SameSite=Lax';
  }

  function deleteCookie() {
    document.cookie = COOKIE + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax';
  }

  function currentTheme() {
    var m = document.body.className.match(/\btheme-(\w+)\b/);
    return m ? m[1] : 'blockery';
  }

  function currentWeekStart() {
    return ((window.OVERLAP_CONFIG || window.ROOSTER_CONFIG || {}).defaults || {}).weekStartDay ?? 1;
  }

  function currentRefreshMin() {
    return (window._overlapRefreshMin !== undefined) ? window._overlapRefreshMin : 15;
  }

  function syncUI() {
    var theme = currentTheme();
    var ws    = currentWeekStart();
    var rm    = currentRefreshMin();
    document.querySelectorAll('.stp-opt').forEach(function (opt) {
      var inp = opt.querySelector('input');
      if (inp) {
        var active = (inp.name === 'stp-theme' && inp.value === theme)
                  || (inp.name === 'stp-week'  && +inp.value === ws);
        opt.classList.toggle('active', active);
      }
    });
    // Refresh opts use data-min instead of radio inputs
    document.querySelectorAll('#refreshOpts .stp-opt').forEach(function (opt) {
      opt.classList.toggle('active', +opt.dataset.min === rm);
    });
  }

  function openPanel() {
    syncUI();
    document.body.classList.add('menu-open');
  }

  function closePanel() {
    document.body.classList.remove('menu-open');
  }

  function applyAndReload(s) {
    writeCookie(s);
    location.reload();
  }

  // Hamburger toggles panel
  document.getElementById('menuBtn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    document.body.classList.contains('menu-open') ? closePanel() : openPanel();
  });

  // Overlay + close button
  document.getElementById('menuOverlay').addEventListener('click', closePanel);
  document.getElementById('stpClose').addEventListener('click', closePanel);

  // Close panel (with short delay for share/print to start) when action buttons clicked
  ['shareBtn', 'shareDrop', 'printLandBtn', 'printPortOpt', 'printLandOpt'].forEach(function (id) {
    document.getElementById(id)?.addEventListener('click', function () {
      setTimeout(closePanel, 120);
    });
  });

  // Radio changes
  document.querySelectorAll('.stp-opt').forEach(function (opt) {
    opt.addEventListener('click', function () {
      var inp = opt.querySelector('input');
      inp.checked = true;
      var s = readCookie();
      if (inp.name === 'stp-theme')  s.theme     = inp.value;
      if (inp.name === 'stp-week')   s.weekStart = +inp.value;
      applyAndReload(s);
    });
  });

  // Auto-refresh interval selector (no reload needed)
  document.querySelectorAll('#refreshOpts .stp-opt').forEach(function (opt) {
    opt.addEventListener('click', function () {
      var min = +opt.dataset.min;
      var s = readCookie();
      s.refreshMin = min;
      writeCookie(s);
      if (typeof window._setRefreshInterval === 'function') window._setRefreshInterval(min);
      document.querySelectorAll('#refreshOpts .stp-opt').forEach(function (o) {
        o.classList.toggle('active', o === opt);
      });
    });
  });

  // Reset — explicitly write Monday start so config-file value is overridden
  document.getElementById('stpReset').addEventListener('click', function () {
    var s = readCookie();
    delete s.theme;
    s.weekStart = 1; // Monday
    writeCookie(s);
    location.reload();
  });
})();

// Date range button opens the date picker (same as Today dropdown arrow)
document.getElementById('hdrDateBtn')?.addEventListener('click', function (e) {
  if (!e.target.closest('#datePicker')) {
    document.getElementById('tBDrop')?.click();
  }
});

// ── Update detection ──────────────────────────────────────────────────────────
(function () {
  var storedTs = window._overlapTs || 0;
  var notified = false;

  function showUpdateNotice() {
    if (notified) return;
    notified = true;
    // Badge on hamburger button
    var btn = document.getElementById('menuBtn');
    if (btn) btn.classList.add('has-update');
    // Item inside the drawer
    var notice = document.getElementById('updateNotice');
    if (notice) notice.style.display = '';
    // Update version label in footer
    var ver = document.getElementById('stp-ver');
    if (ver) ver.textContent = ver.textContent + ' → nieuw';
  }

  function checkUpdate() {
    fetch('?overlap_upd=1', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ts > storedTs) showUpdateNotice(); })
      .catch(function () {});
  }

  // Check on tab becoming visible + every 10 minutes; first check after 45 s
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkUpdate();
  });
  setInterval(checkUpdate, 10 * 60 * 1000);
  setTimeout(checkUpdate, 45000);
})();
</script>

<style>
/* ── Day-view week strip ─────────────────────────────────────────────────── */
body.view-day #weekStrip {
  display: flex !important;
  justify-content: space-around;
  align-items: center;
  padding: 4px 8px 2px;
  background: var(--gd, #1a3d2b);
  gap: 0;
}
body.view-day #weekStrip .ws-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
  cursor: pointer;
  padding: 5px 2px 4px;
  border-radius: 10px;
  transition: background .12s;
}
body.view-day #weekStrip .ws-day:hover { background: rgba(255,255,255,.08); }
body.view-day #weekStrip .ws-dn {
  font-size: .65rem;
  font-weight: 600;
  color: rgba(255,255,255,.65);
  text-transform: uppercase;
  letter-spacing: .04em;
}
body.view-day #weekStrip .ws-num {
  font-size: .95rem;
  font-weight: 500;
  color: rgba(255,255,255,.85);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
body.view-day #weekStrip .ws-sel .ws-num {
  background: #fff;
  color: var(--gd, #1a3d2b);
  font-weight: 700;
}
body.view-day #weekStrip .ws-today:not(.ws-sel) .ws-num {
  border: 2px solid rgba(255,255,255,.5);
}
body.view-day #weekStrip .ws-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: transparent;
}
body.view-day #weekStrip .ws-dot.has-ev { background: rgba(255,255,255,.5); }

/* ── Day-view: 9:16 portrait on desktop, full-width on mobile ────────────── */
body.view-day .cw {
  max-width: min(calc(100vw - 20px), var(--day-view-width, 560px)) !important;
  min-height: calc(100vh - var(--header-h, 64px)) !important;
  padding: 0 0 42px !important;
}

/* ── Side menu drawer ────────────────────────────────────────────────────── */
#menuOverlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 550;
  cursor: pointer;
}
body.menu-open #menuOverlay { display: block; }

#settingsPanel {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 600;
  background: var(--gd, #1a3d2b);
  color: var(--cr, #f8f5ee);
  width: 272px;
  max-width: 88vw;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: 'DM Sans', sans-serif;
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 32px rgba(0,0,0,.35);
  transform: translateX(-110%);
  transition: transform .26s cubic-bezier(.4,0,.2,1);
}
body.menu-open #settingsPanel { transform: translateX(0); }

.stp-head {
  background: rgba(0,0,0,.22);
  color: var(--cr, #f8f5ee);
  padding: 0 16px;
  min-height: 52px;
  font-size: .9rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255,255,255,.08);
  flex-shrink: 0;
}
.stp-head button {
  background: rgba(255,255,255,.12);
  border: none;
  color: var(--cr, #f8f5ee);
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: .85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .8;
  transition: .12s;
}
.stp-head button:hover { opacity: 1; background: rgba(255,255,255,.22); }

.stp-section {
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.stp-label {
  font-size: .64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: rgba(255,255,255,.45);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.stp-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 12px;
  background: rgba(255,255,255,.1);
  color: var(--cr, #f8f5ee);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 9px;
  font-size: .83rem;
  font-weight: 500;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  margin-bottom: 6px;
  transition: background .14s, transform .1s;
  text-align: left;
}
.stp-btn:last-child { margin-bottom: 0; }
.stp-btn:hover { background: rgba(255,255,255,.2); }
.stp-btn:active { transform: scale(.97); }
.stp-btn svg { opacity: .75; flex-shrink: 0; }
.stp-btn.btn-pink {
  background: rgba(244,63,94,.22);
  border-color: rgba(244,63,94,.3);
  color: #fda4af;
}
.stp-btn.btn-pink svg { opacity: .9; }
.stp-btn.btn-pink:hover { background: rgba(244,63,94,.38); }

.stp-opts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.stp-opt {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 5px 13px;
  border-radius: 20px;
  border: 1.5px solid rgba(255,255,255,.2);
  font-size: .8rem;
  font-weight: 500;
  background: rgba(255,255,255,.08);
  color: var(--cr, #f8f5ee);
  transition: background .12s, border-color .12s;
  white-space: nowrap;
  user-select: none;
}
.stp-opt input[type=radio] { display: none; }
.stp-opt.active {
  background: var(--ac, #52b788);
  color: #fff;
  border-color: var(--ac, #52b788);
}

.stp-footer {
  padding: 14px 16px 20px;
  margin-top: auto;
}
#stpReset {
  width: 100%;
  padding: 9px;
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 9px;
  font-size: .76rem;
  color: rgba(255,255,255,.45);
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  transition: .14s;
}
#stpReset:hover { background: rgba(220,38,38,.25); color: #fca5a5; border-color: rgba(220,38,38,.3); }

/* About / version footer in drawer */
.stp-about {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.08);
  text-align: center;
}
.stp-about-name {
  font-size: .78rem;
  font-weight: 700;
  color: var(--cr, #f8f5ee);
  letter-spacing: .04em;
}
.stp-about-ver {
  font-size: .7rem;
  color: rgba(255,255,255,.4);
  margin: 2px 0 6px;
  font-variant-numeric: tabular-nums;
}
.stp-about-meta {
  font-size: .72rem;
  color: rgba(255,255,255,.35);
}
.stp-about-meta a {
  color: rgba(255,255,255,.55);
  text-decoration: none;
}
.stp-about-meta a:hover { color: var(--cr, #f8f5ee); text-decoration: underline; }

/* Update notice button */
.stp-btn-update {
  background: rgba(251,191,36,.18);
  border-color: rgba(251,191,36,.35);
  color: #fff;
  animation: upd-pulse 2s ease-in-out infinite;
}
.stp-btn-update:hover { background: rgba(251,191,36,.32); }
.stp-btn-update svg { opacity: 1; }
@keyframes upd-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); }
  50%      { box-shadow: 0 0 0 5px rgba(251,191,36,.18); }
}

/* Install button */
.stp-btn-install {
  background: rgba(99,102,241,.18);
  border-color: rgba(99,102,241,.3);
  color: #fff;
}
.stp-btn-install:hover { background: rgba(99,102,241,.32); }

/* Hamburger update badge */
#menuBtn { position: relative; }
#menuBtn.has-update::after {
  content: '';
  position: absolute;
  top: 5px; right: 5px;
  width: 8px; height: 8px;
  background: #fbbf24;
  border-radius: 50%;
  border: 2px solid var(--gd, #1a3d2b);
  animation: upd-dot 1.8s ease-in-out infinite;
}
@keyframes upd-dot {
  0%,100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.4); opacity: .7; }
}
</style>
</body>
</html>
