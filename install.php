<?php
declare(strict_types=1);
require_once __DIR__ . '/lib/Auth.php';

// ── Files that PHP needs to be able to write ──────────────────────────────────
$writableFiles = [
    'app/overlap-config.js',
    'app/overlap-manifest.json',
    'app/icon-192.png',
    'app/icon-512.png',
];
$writableDirs = ['uploads'];

$error   = '';
$success = false;
$alreadyInstalled = Auth::isInstalled();

// ── Handle reset token (allows re-running install when locked out) ────────────
// Create the file  lib/.reset  on the server to enable one-time re-install.
$resetAllowed = file_exists(__DIR__ . '/lib/.reset');

if ($alreadyInstalled && !$resetAllowed) {
    // Already set up and no reset token — redirect to manage
    if (Auth::isLoggedIn()) {
        header('Location: manage/index.php');
    } else {
        header('Location: manage/login.php');
    }
    exit;
}

// ── Apply file permissions automatically ─────────────────────────────────────
function applyPermissions(): array
{
    global $writableFiles, $writableDirs;
    $results = [];
    foreach ($writableFiles as $rel) {
        $path = __DIR__ . '/' . $rel;
        if (!file_exists($path)) {
            // Create empty placeholder so chmod can succeed later
            @touch($path);
        }
        $ok = @chmod($path, 0664);
        $results[] = ['path' => $rel, 'ok' => $ok];
    }
    foreach ($writableDirs as $rel) {
        $path = __DIR__ . '/' . $rel;
        if (!is_dir($path)) @mkdir($path, 0775, true);
        $ok = @chmod($path, 0775);
        $results[] = ['path' => $rel . '/', 'ok' => $ok, 'dir' => true];
    }
    return $results;
}

// ── Handle form submission ────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username  = trim($_POST['username']  ?? '');
    $password  = $_POST['password']  ?? '';
    $password2 = $_POST['password2'] ?? '';

    if ($username === '') {
        $error = 'Username cannot be empty.';
    } elseif (!preg_match('/^[a-zA-Z0-9_\-\.@]{2,64}$/', $username)) {
        $error = 'Username may only contain letters, numbers, . _ - @ (2–64 characters).';
    } elseif (strlen($password) < 8) {
        $error = 'Password must be at least 8 characters.';
    } elseif ($password !== $password2) {
        $error = 'Passwords do not match.';
    } else {
        try {
            Auth::setCredentials($username, $password);
            applyPermissions();
            // Remove reset token if it was used
            if ($resetAllowed) @unlink(__DIR__ . '/lib/.reset');
            $success = true;
        } catch (Throwable $e) {
            $error = $e->getMessage();
        }
    }
}

$permResults = applyPermissions(); // show status on page even before submit
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overlap – <?= $alreadyInstalled ? 'Reset credentials' : 'Install' ?></title>
<link rel="stylesheet" href="assets/css/admin.css">
<style>
  body { display: flex; align-items: flex-start; justify-content: center; min-height: 100vh; background: #f4f6f8; padding: 40px 16px; box-sizing: border-box; }
  .install-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.1); padding: 36px 40px; width: 100%; max-width: 460px; }
  .install-card h1 { font-size: 1.4rem; margin: 0 0 4px; color: var(--green, #1a3d2b); }
  .install-card .subtitle { font-size: .85rem; color: #666; margin-bottom: 28px; }
  .form-row { margin-bottom: 18px; }
  .form-row label { display: block; font-size: .82rem; font-weight: 600; color: #444; margin-bottom: 5px; }
  .form-row input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1.5px solid #d1d5db; border-radius: 7px; font-size: .92rem; transition: border-color .15s; }
  .form-row input:focus { outline: none; border-color: var(--green, #1a3d2b); }
  .btn-primary { width: 100%; padding: 11px; background: var(--green, #1a3d2b); color: #fff; border: none; border-radius: 7px; font-size: .95rem; font-weight: 600; cursor: pointer; margin-top: 6px; }
  .btn-primary:hover { opacity: .88; }
  .alert { padding: 11px 14px; border-radius: 7px; font-size: .87rem; margin-bottom: 20px; }
  .alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
  .alert-success { background: #f0fdf4; color: #166534; border: 1px solid #86efac; }
  .perm-table { width: 100%; border-collapse: collapse; font-size: .8rem; margin-top: 24px; }
  .perm-table th { text-align: left; padding: 5px 8px; color: #666; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  .perm-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; color: #333; }
  .ok { color: #16a34a; font-weight: 700; }
  .fail { color: #dc2626; font-weight: 700; }
  .section-title { font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #999; margin: 28px 0 10px; }
</style>
</head>
<body>
<div class="install-card">
  <h1>Overlap <?= $alreadyInstalled ? 'Reset Credentials' : 'Setup' ?></h1>
  <p class="subtitle">
    <?= $alreadyInstalled
        ? 'A reset token was found. You can set new admin credentials below.'
        : 'Welcome! Choose a username and password for the admin panel.' ?>
  </p>

  <?php if ($success): ?>
    <div class="alert alert-success">
      <?= $alreadyInstalled ? 'Credentials updated.' : 'Setup complete.' ?>
      Admin account <strong><?= htmlspecialchars($_POST['username'] ?? '') ?></strong> is ready.
    </div>
    <a href="manage/login.php" class="btn-primary" style="display:block;text-align:center;text-decoration:none;padding:11px">
      Go to admin panel →
    </a>
  <?php else: ?>
    <?php if ($error): ?>
      <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>
    <form method="post" autocomplete="off">
      <div class="form-row">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username"
               value="<?= htmlspecialchars($_POST['username'] ?? '') ?>">
      </div>
      <div class="form-row">
        <label for="password">Password <span style="font-weight:400;color:#888">(min. 8 characters)</span></label>
        <input type="password" id="password" name="password" required autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="password2">Confirm password</label>
        <input type="password" id="password2" name="password2" required autocomplete="new-password">
      </div>
      <button type="submit" class="btn-primary">
        <?= $alreadyInstalled ? 'Update credentials' : 'Create admin account' ?>
      </button>
    </form>
  <?php endif; ?>

  <div class="section-title">File permissions</div>
  <table class="perm-table">
    <tr><th>File / folder</th><th>Status</th></tr>
    <?php foreach ($permResults as $r): ?>
    <tr>
      <td><?= htmlspecialchars($r['path']) ?></td>
      <td class="<?= $r['ok'] ? 'ok' : 'fail' ?>"><?= $r['ok'] ? '✓ writable' : '✗ failed' ?></td>
    </tr>
    <?php endforeach; ?>
  </table>

  <?php if (!$success && $alreadyInstalled): ?>
    <p style="margin-top:18px;font-size:.8rem;color:#888">
      To lock this page again, delete <code>lib/.reset</code> from the server.
    </p>
  <?php endif; ?>
  <?php if (!$alreadyInstalled): ?>
    <p style="margin-top:18px;font-size:.8rem;color:#888">
      To re-run setup in future (e.g. password reset), create an empty file
      <code>lib/.reset</code> on the server, then revisit this page.
    </p>
  <?php endif; ?>
</div>
</body>
</html>
