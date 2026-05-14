<?php
// Shared nav header for all manage pages
// $pageTitle and $activePage must be set before including this file.

$pageTitle  = $pageTitle  ?? 'Overlap Beheer';
$activePage = $activePage ?? '';

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
</head>
<body>

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
      <a href="../index.html" target="_blank">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        View schedule
      </a>
    </li>
  </ul>
  <div class="nav-footer">app/overlap-config.js</div>
</nav>

<div id="main">
