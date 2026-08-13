<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';

$pageTitle  = 'Volunteers';
$activePage = 'volunteers';

$flash     = null;
$flashType = 'success';

// ── Save ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['_action'] ?? '') === 'save') {
    try {
        $cfg  = Config::read();
        $rows = $_POST['crew'] ?? [];
        $crew = [];

        foreach ($rows as $row) {
            $name  = trim($row['name']  ?? '');
            $color = trim($row['color'] ?? '#999999');
            $bday  = trim($row['bday']  ?? '');
            $aliases = array_values(array_unique(array_filter(array_map('trim', explode('|', $row['aliases'] ?? '')))));

            if ($name === '') continue; // skip blank rows

            // Use color_text field if it's a valid hex (overrides color picker if different)
            $colorText = trim($row['color_text'] ?? '');
            if (preg_match('/^#[0-9a-fA-F]{6}$/', $colorText)) {
                $color = $colorText;
            }

            // Validate color
            if (!preg_match('/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $color)) {
                $color = '#999999';
            }

            // Validate bday format DD-MM
            if ($bday && !preg_match('/^\d{2}-\d{2}$/', $bday)) {
                $bday = '';
            }

            $entry = ['name' => $name, 'color' => $color];
            if ($bday) $entry['bday'] = $bday;
            if ($aliases) $entry['aliases'] = $aliases;
            $crew[] = $entry;
        }

        $cfg['crew'] = $crew;
        Config::write($cfg);
        $flash = count($crew) . ' volunteers saved.';
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

$crew = $cfg['crew'] ?? [];

include '_header.php';
?>

<div class="page-header">
  <div>
    <h2>Volunteers</h2>
    <p><?= count($crew) ?> configured</p>
  </div>
</div>

<div class="page-body">

<?php if ($loadError): ?>
<div class="alert alert-error"><strong>Config error:</strong> <?= htmlspecialchars($loadError) ?></div>
<?php endif; ?>

<?php if ($flash): ?>
<div class="alert alert-<?= $flashType === 'error' ? 'error' : 'success' ?>"><?= htmlspecialchars($flash) ?></div>
<?php endif; ?>

<form method="POST" id="crewForm">
  <input type="hidden" name="_action" value="save">

  <div class="card">
    <div class="card-header">
      <h3>Volunteer list</h3>
    </div>
    <div class="card-body" style="padding:0">
      <table class="data-table" style="table-layout:fixed">
        <colgroup>
          <col style="width:auto">
          <col style="width:160px">
          <col style="width:90px">
          <col style="width:220px">
          <col style="width:70px">
          <col style="width:50px">
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Color</th>
            <th>Birthday</th>
            <th>Aliases (separate with |)</th>
            <th>Order</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="crewTbody"></tbody>
      </table>
      <div style="padding:12px 16px;border-top:1px solid var(--border)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addCrewRow()">+ Add volunteer</button>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:10px;margin-top:4px">
    <button type="submit" class="btn btn-primary">Save</button>
    <a href="index.php" class="btn btn-secondary">Cancel</a>
  </div>
</form>

</div><!-- .page-body -->

<?php include '_footer.php'; ?>

<script>
// Pre-populate crew rows from PHP data
const crewData = <?= json_encode(array_values($crew), JSON_UNESCAPED_UNICODE) ?>;
crewData.forEach(m => addCrewRow(m.name, m.color, m.bday || '', (m.aliases || []).join(' | ')));
</script>
