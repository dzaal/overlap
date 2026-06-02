<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Auth.php';

if (!Auth::isInstalled()) {
    header('Location: ../install.php'); exit;
}
if (Auth::isLoggedIn()) {
    header('Location: index.php'); exit;
}

$error = '';
$next  = preg_replace('/[^a-zA-Z0-9\/_\-\.?=&]/', '', $_GET['next'] ?? 'index.php');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Auth::verifyCsrf($_POST['csrf'] ?? '')) {
        $error = 'Invalid request. Please try again.';
    } elseif (Auth::login($_POST['username'] ?? '', $_POST['password'] ?? '')) {
        header('Location: ' . $next); exit;
    } else {
        $error = 'Incorrect username or password.';
    }
}
$token = Auth::csrfToken();
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overlap – Admin login</title>
<link rel="stylesheet" href="../assets/css/admin.css">
<style>
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f4f6f8; }
  .login-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.1); padding: 36px 40px; width: 100%; max-width: 380px; }
  .login-card h1 { font-size: 1.3rem; margin: 0 0 4px; color: var(--green, #1a3d2b); }
  .login-card .subtitle { font-size: .85rem; color: #666; margin-bottom: 26px; }
  .form-row { margin-bottom: 16px; }
  .form-row label { display: block; font-size: .82rem; font-weight: 600; color: #444; margin-bottom: 5px; }
  .form-row input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1.5px solid #d1d5db; border-radius: 7px; font-size: .92rem; transition: border-color .15s; }
  .form-row input:focus { outline: none; border-color: var(--green, #1a3d2b); }
  .btn-primary { width: 100%; padding: 11px; background: var(--green, #1a3d2b); color: #fff; border: none; border-radius: 7px; font-size: .95rem; font-weight: 600; cursor: pointer; margin-top: 4px; }
  .btn-primary:hover { opacity: .88; }
  .alert-error { padding: 10px 13px; background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 7px; font-size: .87rem; margin-bottom: 18px; }
</style>
</head>
<body>
<div class="login-card">
  <h1>Overlap Beheer</h1>
  <p class="subtitle">Sign in to the admin panel.</p>
  <?php if ($error): ?>
    <div class="alert-error"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>
  <form method="post">
    <input type="hidden" name="csrf" value="<?= htmlspecialchars($token) ?>">
    <div class="form-row">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" required autofocus autocomplete="username"
             value="<?= htmlspecialchars($_POST['username'] ?? '') ?>">
    </div>
    <div class="form-row">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
    </div>
    <button type="submit" class="btn-primary">Sign in</button>
  </form>
</div>
</body>
</html>
