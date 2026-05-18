<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';

$pageTitle  = 'Dashboard';
$activePage = 'index';

try {
    $cfg   = Config::read();
    $error = null;
} catch (Throwable $e) {
    $cfg   = [];
    $error = $e->getMessage();
}

$branding  = $cfg['branding'] ?? [];
$crew      = $cfg['crew']     ?? [];
$defaults  = $cfg['defaults'] ?? [];
$calendars = Config::calendarUrls($cfg);

include '_header.php';
?>

<div class="page-header">
  <div>
    <h2>Dashboard</h2>
    <p>Overlap configuration manager</p>
  </div>
  <a href="../index.php" target="_blank" class="btn btn-secondary btn-sm">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    View schedule
  </a>
</div>

<div class="page-body">

<?php if ($error): ?>
<div class="alert alert-error"><strong>Config error:</strong> <?= htmlspecialchars($error) ?></div>
<?php endif; ?>

<div class="stat-grid">
  <div class="stat-card">
    <div class="stat-num"><?= count($crew) ?></div>
    <div class="stat-label">Volunteers</div>
    <a class="stat-link" href="volunteers.php">Manage →</a>
  </div>
  <div class="stat-card">
    <div class="stat-num"><?= count($calendars) ?></div>
    <div class="stat-label">Calendars</div>
    <a class="stat-link" href="calendars.php">Manage →</a>
  </div>
  <div class="stat-card">
    <div class="stat-num"><?= htmlspecialchars($branding['version'] ?? '–') ?></div>
    <div class="stat-label">Version</div>
    <a class="stat-link" href="display.php">Display →</a>
  </div>
  <div class="stat-card">
    <div class="stat-num" style="font-size:1.1rem;padding-top:4px"><?= htmlspecialchars($defaults['timeZone'] ?? 'Europe/Amsterdam') ?></div>
    <div class="stat-label">Timezone</div>
    <a class="stat-link" href="display.php">Change →</a>
  </div>
</div>

<!-- App info -->
<div class="card">
  <div class="card-header"><h3>App settings</h3><a href="display.php" class="btn btn-secondary btn-sm">Edit</a></div>
  <div class="card-body">
    <table class="data-table">
      <tbody>
        <?php
        $fields = [
          'Name'             => $branding['appName']        ?? '–',
          'Short name'       => $branding['appShortName']   ?? '–',
          'Description'      => $branding['appDescription'] ?? '–',
          'Site URL'         => $branding['siteUrl']        ?? '–',
          'Start URL'        => $branding['startUrl']       ?? '–',
          'Theme color'      => $branding['themeColor']     ?? '–',
          'Default location' => $branding['defaultLocation'] ?? '–',
        ];
        foreach ($fields as $label => $val):
        ?>
        <tr>
          <td style="font-weight:600;width:160px;color:var(--muted);font-size:.8rem"><?= htmlspecialchars($label) ?></td>
          <td>
            <?php if ($label === 'Theme color' && $val && $val !== '–'): ?>
              <span class="swatch" style="background:<?= htmlspecialchars($val) ?>"></span>
            <?php endif; ?>
            <?= htmlspecialchars($val) ?>
          </td>
        </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</div>

<!-- Calendars -->
<div class="card">
  <div class="card-header"><h3>Configured calendars</h3><a href="calendars.php" class="btn btn-secondary btn-sm">Manage</a></div>
  <div class="card-body" style="padding:0">
    <table class="data-table">
      <thead><tr><th>Label</th><th>URL</th></tr></thead>
      <tbody>
        <?php if (empty($calendars)): ?>
        <tr><td colspan="2" style="color:var(--muted);font-style:italic">No calendars configured.</td></tr>
        <?php else: ?>
        <?php foreach ($calendars as $cal): ?>
        <tr>
          <td><?= htmlspecialchars($cal['label']) ?></td>
          <td style="font-size:.78rem;color:var(--muted);font-family:monospace;word-break:break-all"><?= htmlspecialchars(substr($cal['url'], 0, 90)) ?><?= strlen($cal['url']) > 90 ? '…' : '' ?></td>
        </tr>
        <?php endforeach; ?>
        <?php endif; ?>
      </tbody>
    </table>
  </div>
</div>

<!-- Crew -->
<div class="card">
  <div class="card-header"><h3>Volunteers (<?= count($crew) ?>)</h3><a href="volunteers.php" class="btn btn-secondary btn-sm">Manage</a></div>
  <div class="card-body">
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <?php foreach (array_slice($crew, 0, 20) as $m): ?>
      <span style="display:inline-flex;align-items:center;gap:5px;background:#f4f6f4;border:1px solid #d8e0d8;border-radius:20px;padding:4px 11px;font-size:.82rem">
        <span class="swatch" style="background:<?= htmlspecialchars($m['color'] ?? '#999') ?>"></span>
        <?= htmlspecialchars($m['name'] ?? '') ?>
        <?php if (!empty($m['bday'])): ?><span style="color:var(--muted);font-size:.72rem"><?= htmlspecialchars($m['bday']) ?></span><?php endif; ?>
      </span>
      <?php endforeach; ?>
      <?php if (count($crew) > 20): ?>
      <span style="color:var(--muted);font-size:.82rem;padding:4px 8px">… and <?= count($crew) - 20 ?> more</span>
      <?php endif; ?>
    </div>
  </div>
</div>

</div>
<?php include '_footer.php'; ?>
