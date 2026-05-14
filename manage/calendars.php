<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/CalendarDiagnostics.php';

$pageTitle  = 'Calendars';
$activePage = 'calendars';

$flash   = null;
$flashType = 'success';

// ── Save ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['_action'] ?? '') === 'save') {
    try {
        $cfg = Config::read();
        $d   = &$cfg['defaults'];

        $d['calendarUrl']          = trim($_POST['calendarUrl']          ?? '');
        $d['appointmentUrl']       = trim($_POST['appointmentUrl']       ?? '');
        $d['mainEventCalendarUrl'] = trim($_POST['mainEventCalendarUrl'] ?? '');

        Config::write($cfg);
        $flash = 'Calendar settings saved.';
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

$d         = $cfg['defaults'] ?? [];
$calendars = Config::calendarUrls($cfg);

// Calendar fields with labels and descriptions
$fields = [
    'calendarUrl' => [
        'label' => 'Main schedule',
        'desc'  => 'Primary ICS URL for the volunteer shift calendar.',
        'req'   => true,
    ],
    'appointmentUrl' => [
        'label' => 'Appointments',
        'desc'  => 'ICS URL for the appointments calendar.',
        'req'   => false,
    ],
    'mainEventCalendarUrl' => [
        'label' => 'Events',
        'desc'  => 'ICS URL for the events/activities calendar.',
        'req'   => false,
    ],
];

include '_header.php';
?>

<div class="page-header">
  <div>
    <h2>Calendars</h2>
    <p>Manage ICS calendar feeds for the schedule</p>
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

  <?php foreach ($fields as $key => $meta): ?>
  <div class="card">
    <div class="card-header">
      <div>
        <h3><?= htmlspecialchars($meta['label']) ?> <?= $meta['req'] ? '' : '<span style="font-weight:400;color:var(--muted);font-size:.8rem">(optional)</span>' ?></h3>
        <p style="font-size:.78rem;color:var(--muted);margin-top:2px"><?= htmlspecialchars($meta['desc']) ?></p>
      </div>
      <?php $hasUrl = !empty($d[$key]); ?>
      <?php if ($hasUrl): ?>
        <span class="badge badge-green">Configured</span>
      <?php else: ?>
        <span class="badge badge-gray">Empty</span>
      <?php endif; ?>
    </div>
    <div class="card-body">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1">
          <input type="url" id="<?= $key ?>" name="<?= $key ?>"
                 value="<?= htmlspecialchars($d[$key] ?? '') ?>"
                 placeholder="https://calendar.google.com/calendar/ical/…"
                 style="width:100%;font-family:monospace;font-size:.8rem"
                 <?= $meta['req'] ? 'required' : '' ?>>
        </div>
        <button type="button" class="btn btn-secondary btn-sm"
                onclick="testCalendar(document.getElementById('<?= $key ?>').value, document.getElementById('diag_<?= $key ?>'))">
          ▶ Test
        </button>
      </div>
      <div id="diag_<?= $key ?>" style="display:none;margin-top:10px"></div>
    </div>
  </div>
  <?php endforeach; ?>

  <div style="display:flex;gap:10px;margin-top:4px">
    <button type="submit" class="btn btn-primary">Save</button>
    <a href="index.php" class="btn btn-secondary">Cancel</a>
  </div>
</form>

<!-- How the proxy works -->
<div class="card" style="margin-top:28px">
  <div class="card-header"><h3>Proxy &amp; cache</h3></div>
  <div class="card-body">
    <p style="font-size:.85rem;color:var(--muted);line-height:1.7">
      The schedule fetches calendars via <code style="background:#f0f0f0;padding:1px 5px;border-radius:3px">app/proxy.php</code>.
      Responses are cached for 15 minutes. Only URLs listed in the configuration are allowed through.
    </p>
    <div style="margin-top:10px">
      <strong style="font-size:.82rem">Configured URLs:</strong>
      <ul style="margin-top:6px;font-size:.78rem;font-family:monospace;color:var(--muted);line-height:2">
        <?php foreach ($calendars as $cal): ?>
          <?php if (!empty($cal['url'])): ?>
          <li style="word-break:break-all"><?= htmlspecialchars($cal['url']) ?></li>
          <?php endif; ?>
        <?php endforeach; ?>
      </ul>
    </div>
  </div>
</div>

</div><!-- .page-body -->

<?php include '_footer.php'; ?>
