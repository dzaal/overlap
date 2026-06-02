<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/Auth.php';
Auth::requireLogin();

$pageTitle  = 'Change password';
$activePage = 'account';
$error      = '';
$success    = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Auth::verifyCsrf($_POST['csrf'] ?? '')) {
        $error = 'Invalid request. Please try again.';
    } else {
        $current  = $_POST['current']   ?? '';
        $new      = $_POST['password']  ?? '';
        $confirm  = $_POST['password2'] ?? '';

        if (!Auth::login(Auth::getUsername(), $current)) {
            $error = 'Current password is incorrect.';
        } elseif (strlen($new) < 8) {
            $error = 'New password must be at least 8 characters.';
        } elseif ($new !== $confirm) {
            $error = 'Passwords do not match.';
        } else {
            try {
                Auth::setCredentials(Auth::getUsername(), $new);
                $success = true;
            } catch (Throwable $e) {
                $error = $e->getMessage();
            }
        }
    }
}

$token = Auth::csrfToken();
require_once __DIR__ . '/_header.php';
?>

<div class="card" style="max-width:460px">
  <h2 style="margin-top:0">Change password</h2>
  <p style="color:#666;font-size:.88rem">Logged in as <strong><?= htmlspecialchars(Auth::getUsername()) ?></strong></p>

  <?php if ($success): ?>
    <div class="alert alert-success" style="margin-bottom:20px">Password updated successfully.</div>
  <?php endif; ?>
  <?php if ($error): ?>
    <div class="alert alert-error" style="margin-bottom:20px"><?= htmlspecialchars($error) ?></div>
  <?php endif; ?>

  <form method="post">
    <input type="hidden" name="csrf" value="<?= htmlspecialchars($token) ?>">
    <div class="form-group">
      <label>Current password</label>
      <input type="password" name="current" required autocomplete="current-password" class="form-control">
    </div>
    <div class="form-group">
      <label>New password <span style="font-weight:400;color:#888">(min. 8 characters)</span></label>
      <input type="password" name="password" required autocomplete="new-password" class="form-control">
    </div>
    <div class="form-group">
      <label>Confirm new password</label>
      <input type="password" name="password2" required autocomplete="new-password" class="form-control">
    </div>
    <button type="submit" class="btn btn-primary">Update password</button>
  </form>
</div>

<?php require_once __DIR__ . '/_footer.php'; ?>
