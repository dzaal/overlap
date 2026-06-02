<?php
// Shared nav header for all manage pages
// $pageTitle and $activePage must be set before including this file.
require_once __DIR__ . '/../lib/Auth.php';
Auth::requireLogin();

$pageTitle  = $pageTitle  ?? 'Overlap Beheer';
$activePage = $activePage ?? '';

// ── Read theme color from config ──────────────────────────────────────────────
$_themeColor  = '#1a3d2b';
$_accentColor = '#52b788';
$_fgColor     = '#f8f5ee';

if (class_exists('Config')) {
    try {
        $_cfg = Config::read();
        $_b   = $_cfg['branding'] ?? [];

        $_tc = $_b['themeColor'] ?? '';
        if (preg_match('/^#[0-9a-fA-F]{6}$/i', $_tc)) {
            $_themeColor = $_tc;
            // Derive accent from theme color (45% toward white) as fallback
            $_r = hexdec(substr($_tc, 1, 2));
            $_g = hexdec(substr($_tc, 3, 2));
            $_b2 = hexdec(substr($_tc, 5, 2));
            $_accentColor = sprintf('#%02x%02x%02x',
                min(255, (int)($_r  + (255 - $_r)  * 0.45)),
                min(255, (int)($_g  + (255 - $_g)  * 0.45)),
                min(255, (int)($_b2 + (255 - $_b2) * 0.45))
            );
        }
        // Use explicit accent color if configured
        $_ac = $_b['accentColor'] ?? '';
        if (preg_match('/^#[0-9a-fA-F]{6}$/i', $_ac)) {
            $_accentColor = $_ac;
        }
        $_fgc = $_b['foregroundColor'] ?? '';
        if (preg_match('/^#[0-9a-fA-F]{6}$/i', $_fgc)) {
            $_fgColor = $_fgc;
        }
    } catch (Throwable $e) { /* keep defaults */ }
}

$baseUrl = dirname($_SERVER['SCRIPT_NAME'], 1); // e.g. /overlap/manage
$root    = dirname($_SERVER['SCRIPT_NAME'], 2); // e.g. /overlap

$navItems = [
  'index'      => ['label' => 'Dashboard',  'icon' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>', 'href' => 'index.php'],
  'calendars'  => ['label' => 'Calendars',  'icon' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', 'href' => 'calendars.php'],
  'volunteers' => ['label' => 'Volunteers', 'icon' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', 'href' => 'volunteers.php'],
  'schedule'   => ['label' => 'Schedule',   'icon' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>', 'href' => 'schedule.php'],
  'display'    => ['label' => 'Display',    'icon' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>', 'href' => 'display.php'],
];
?>
<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($pageTitle) ?> – Overlap Beheer</title>
<link rel="stylesheet" href="../assets/css/admin.css">
<style>:root{--green:<?= htmlspecialchars($_themeColor) ?>;--accent:<?= htmlspecialchars($_accentColor) ?>;--nav-fg:<?= htmlspecialchars($_fgColor) ?>}</style>
<?php
$_faviconUrl = !empty($_b['logoUrl']) ? $_b['logoUrl'] : '../app/icon-192.png';
?>
<link rel="icon" href="<?= htmlspecialchars($_faviconUrl) ?>">
</head>
<body>

<div id="mob-bar">
  <button id="navToggle" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  </button>
  <span class="mob-title"><?= htmlspecialchars($pageTitle) ?> – Overlap</span>
</div>
<div id="nav-overlay" onclick="document.body.classList.remove('nav-open')"></div>

<nav id="nav">
  <div class="nav-logo">
    <h1>Overlap</h1>
    <span>Configuratiebeheer</span>
  </div>
  <ul class="nav-links">
    <?php foreach ($navItems as $key => $item): ?>
    <li>
      <a href="<?= $item['href'] ?>" class="<?= $activePage === $key ? 'active' : '' ?>">
        <?= $item['icon'] ?> <?= htmlspecialchars($item['label']) ?>
      </a>
    </li>
    <?php endforeach; ?>
    <li style="margin-top:12px;border-top:1px solid rgba(255,255,255,.1);padding-top:12px;">
      <a href="../index.php" target="_blank">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        View schedule
      </a>
    </li>
    <li style="margin-top:4px;">
      <a href="change-password.php" class="<?= ($activePage ?? '') === 'account' ? 'active' : '' ?>">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change password
      </a>
    </li>
    <li style="margin-top:4px;">
      <a href="logout.php">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign out
      </a>
    </li>
  </ul>
  <div class="nav-footer">
    <?= htmlspecialchars(Auth::getUsername()) ?> · app/overlap-config.js
  </div>
</nav>

<div id="main">
