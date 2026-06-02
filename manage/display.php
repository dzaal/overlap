<?php
declare(strict_types=1);
require_once __DIR__ . '/../lib/Config.php';

$pageTitle  = 'Display';
$activePage = 'display';

$flash     = null;
$flashType = 'success';

// ── Derive sensible defaults from the current host ────────────────────────────
function hostDefaults(): array
{
    $host     = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $host     = preg_replace('/^www\./', '', $host);
    $baseName = ucfirst(explode('.', $host)[0]);
    $proto    = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $baseUrl  = $proto . '://' . $host;

    // Derive a path prefix (e.g. /overlap)
    $script   = $_SERVER['SCRIPT_NAME'] ?? '';          // /overlap/manage/display.php
    $parts    = explode('/', trim($script, '/'));
    $appPath  = '/' . ($parts[0] ?? '');                // /overlap

    return [
        'appName'         => $baseName . ' Volunteer Schedule',
        'appShortName'    => $baseName,
        'appDescription'  => 'Volunteer schedule of ' . $host,
        'defaultLocation' => $baseName,
        'shareFilePrefix' => strtolower($baseName),
        'themeColor'      => '#1a3d2b',
    ];
}

// ── Handle logo upload with resizing ─────────────────────────────────────────
function handleLogoUpload(): ?string
{
    if (empty($_FILES['logoFile']['tmp_name'])) return null;

    $file    = $_FILES['logoFile'];
    $allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

    if (!in_array($file['type'], $allowed, true)) {
        throw new RuntimeException('Invalid file type. Allowed: PNG, JPEG, GIF, WebP, SVG.');
    }
    if ($file['size'] > 5 * 1024 * 1024) {
        throw new RuntimeException('File too large (max 5 MB).');
    }

    $uploadDir = __DIR__ . '/../uploads/';
    $appDir    = __DIR__ . '/../app/';

    // SVG: just save as-is (no raster resize needed)
    if ($file['type'] === 'image/svg+xml') {
        $dest = $uploadDir . 'logo.svg';
        foreach (glob($uploadDir . 'logo.*') as $f) @unlink($f);
        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new RuntimeException('Upload failed. Check directory permissions.');
        }
        return logoPublicUrl('uploads/logo.svg');
    }

    // Raster: load source image
    $src = match($file['type']) {
        'image/jpeg' => imagecreatefromjpeg($file['tmp_name']),
        'image/gif'  => imagecreatefromgif($file['tmp_name']),
        'image/webp' => imagecreatefromwebp($file['tmp_name']),
        default      => imagecreatefrompng($file['tmp_name']),
    };
    if (!$src) {
        throw new RuntimeException('Could not read image file.');
    }

    $srcW = imagesx($src);
    $srcH = imagesy($src);

    // Remove old logo uploads
    foreach (glob($uploadDir . 'logo.*') as $f) @unlink($f);

    // Save full-size original as logo.png in uploads/
    $origDest = $uploadDir . 'logo.png';
    saveResized($src, $srcW, $srcH, $srcW, $srcH, $origDest);

    // Resize to PWA icon sizes and overwrite app/icon-*.png
    saveResized($src, $srcW, $srcH, 192, 192, $appDir . 'icon-192.png');
    saveResized($src, $srcW, $srcH, 512, 512, $appDir . 'icon-512.png');

    imagedestroy($src);

    return logoPublicUrl('uploads/logo.png');
}

function saveResized($src, int $srcW, int $srcH, int $dstW, int $dstH, string $path): void
{
    $dst = imagecreatetruecolor($dstW, $dstH);
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
    imagefilledrectangle($dst, 0, 0, $dstW, $dstH, $transparent);
    imagealphablending($dst, true);

    // Centre-crop to square before scaling
    if ($srcW !== $srcH) {
        $side  = min($srcW, $srcH);
        $cropX = (int)(($srcW - $side) / 2);
        $cropY = (int)(($srcH - $side) / 2);
        imagecopyresampled($dst, $src, 0, 0, $cropX, $cropY, $dstW, $dstH, $side, $side);
    } else {
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $dstW, $dstH, $srcW, $srcH);
    }

    imagepng($dst, $path, 9);
    imagedestroy($dst);
}

function logoPublicUrl(string $relativePath): string
{
    $script  = $_SERVER['SCRIPT_NAME'] ?? '';
    $parts   = explode('/', trim($script, '/'));
    $appPath = '/' . ($parts[0] ?? 'overlap');
    $proto   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $proto . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $appPath . '/' . $relativePath;
}

function generateManifest(array $cfg): void
{
    $b      = $cfg['branding'] ?? [];
    $appDir = __DIR__ . '/../app/';

    $manifest = [
        'name'         => $b['appName']        ?? 'Volunteer Schedule',
        'short_name'   => $b['appShortName']   ?? 'Schedule',
        'description'  => $b['appDescription'] ?? '',
        'start_url'    => '../index.php',
        'scope'        => '../',
        'display'      => 'standalone',
        'orientation'  => 'any',
        'background_color' => $b['themeColor'] ?? '#1a3d2b',
        'theme_color'      => $b['themeColor'] ?? '#1a3d2b',
        'prefer_related_applications' => false,
        'icons' => [
            ['src' => 'icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => 'icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
            ['src' => 'icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
        ],
    ];

    @file_put_contents(
        $appDir . 'overlap-manifest.json',
        json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        LOCK_EX
    );
}

// ── Save ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['_action'] ?? '') === 'save') {
    try {
        // Handle logo upload first (may update logoUrl)
        $uploadedLogoUrl = handleLogoUpload();

        $cfg = Config::read();
        $b   = &$cfg['branding'];
        $d   = &$cfg['defaults'];

        $b['appName']         = trim($_POST['appName']         ?? '');
        $b['appShortName']    = trim($_POST['appShortName']    ?? '');
        $b['appDescription']  = trim($_POST['appDescription']  ?? '');
        $b['themeColor']      = trim($_POST['themeColor']      ?? '#1a3d2b');
        $b['foregroundColor'] = trim($_POST['foregroundColor'] ?? '#f8f5ee');
        $b['accentColor']     = trim($_POST['accentColor']     ?? '#52b788');
        $availThemes = array_diff(
            array_map(fn($f) => pathinfo($f, PATHINFO_FILENAME), array_map('basename', glob(__DIR__ . '/../app/*.css') ?: [])),
            ['overlap']
        );
        $themeVal  = preg_replace('/[^a-z0-9_-]/i', '', $_POST['theme'] ?? 'blockery');
        $b['theme'] = in_array($themeVal, $availThemes) ? $themeVal : 'blockery';
        $b['defaultLocation'] = trim($_POST['defaultLocation'] ?? '');
        $b['shareFilePrefix'] = trim($_POST['shareFilePrefix'] ?? '');

        // Logo URL: uploaded file wins, otherwise use the text field
        $b['logoUrl'] = $uploadedLogoUrl ?? trim($_POST['logoUrl'] ?? '');

        $d['timeZone']             = trim($_POST['timeZone']       ?? 'Europe/Amsterdam');
        $d['fontScale']            = max(0.5, min(3.0, (float)($_POST['fontScale']       ?? 1)));
        $d['printFontScale']       = max(0.5, min(4.0, (float)($_POST['printFontScale']  ?? 2)));

        $kw = $_POST['filterKeywords'] ?? [];
        $d['filterKeywords'] = array_values(array_filter(array_map('trim', $kw)));

        Config::write($cfg);
        generateManifest($cfg);
        $flash = 'Display settings saved.' . ($uploadedLogoUrl ? ' Logo uploaded.' : '');
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

$b   = $cfg['branding'] ?? [];
$d   = $cfg['defaults'] ?? [];
$kw  = $d['filterKeywords'] ?? [];
$def = hostDefaults();

// Helper: current value or host-derived default
function val(array $b, string $key, array $def): string {
    return $b[$key] ?? $def[$key] ?? '';
}

include '_header.php';
?>

<div class="page-header">
  <div>
    <h2>Display &amp; Branding</h2>
    <p>App name, colors, fonts and filter settings</p>
  </div>
</div>

<div class="page-body">

<?php if ($loadError): ?>
<div class="alert alert-error"><strong>Config error:</strong> <?= htmlspecialchars($loadError) ?></div>
<?php endif; ?>

<?php if ($flash): ?>
<div class="alert alert-<?= $flashType === 'error' ? 'error' : 'success' ?>"><?= htmlspecialchars($flash) ?></div>
<?php endif; ?>

<form method="POST" enctype="multipart/form-data">
  <input type="hidden" name="_action" value="save">

  <!-- Branding -->
  <div class="card">
    <div class="card-header"><h3>Branding</h3></div>
    <div class="card-body">
      <div class="form-grid">

        <div class="field">
          <label for="appName">App name <span class="req">*</span></label>
          <input type="text" id="appName" name="appName" required
                 value="<?= htmlspecialchars(val($b, 'appName', $def)) ?>"
                 placeholder="<?= htmlspecialchars($def['appName']) ?>">
        </div>

        <div class="field">
          <label for="appShortName">Short name</label>
          <input type="text" id="appShortName" name="appShortName"
                 value="<?= htmlspecialchars(val($b, 'appShortName', $def)) ?>"
                 placeholder="<?= htmlspecialchars($def['appShortName']) ?>">
        </div>

        <div class="field span-2">
          <label for="appDescription">Description</label>
          <input type="text" id="appDescription" name="appDescription"
                 value="<?= htmlspecialchars(val($b, 'appDescription', $def)) ?>">
        </div>

        <!-- Logo -->
        <div class="field span-2">
          <label>Logo</label>
          <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <?php if (!empty($b['logoUrl'])): ?>
            <img src="<?= htmlspecialchars($b['logoUrl']) ?>" alt="Current logo"
                 style="width:48px;height:48px;object-fit:contain;border-radius:8px;border:1px solid var(--border);background:#fff;flex-shrink:0">
            <?php endif; ?>
            <div style="flex:1;min-width:240px">
              <label style="font-size:.76rem;font-weight:500;color:var(--muted);margin-bottom:4px;display:block">Upload new logo (PNG/JPG/SVG, max 2 MB)</label>
              <input type="file" id="logoFile" name="logoFile" accept="image/*"
                     style="font-size:.82rem">
              <div style="margin-top:8px">
                <label style="font-size:.76rem;font-weight:500;color:var(--muted);margin-bottom:4px;display:block">Or enter URL directly</label>
                <input type="url" id="logoUrl" name="logoUrl"
                       value="<?= htmlspecialchars($b['logoUrl'] ?? '') ?>"
                       placeholder="https://example.com/logo.png">
              </div>
            </div>
          </div>
          <span class="field-hint">Uploading a file will overwrite the URL field.</span>
        </div>

        <div class="field">
          <label for="themeColor">Theme color</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="themeColor" name="themeColor"
                   value="<?= htmlspecialchars(val($b, 'themeColor', $def)) ?>"
                   style="width:48px;height:36px;padding:2px;flex-shrink:0"
                   oninput="onThemeColorChange()">
            <input type="text" id="themeColorText"
                   value="<?= htmlspecialchars(val($b, 'themeColor', $def)) ?>"
                   maxlength="7" placeholder="#rrggbb" style="font-family:monospace;width:90px"
                   oninput="syncThemeColor(this)">
          </div>
        </div>

        <div class="field">
          <label for="foregroundColor">Foreground color <span style="font-weight:400;color:var(--muted);font-size:.78rem">(text on theme color)</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="color" id="foregroundColor" name="foregroundColor"
                   value="<?= htmlspecialchars($b['foregroundColor'] ?? '#f8f5ee') ?>"
                   style="width:48px;height:36px;padding:2px;flex-shrink:0"
                   oninput="onFgColorChange()">
            <input type="text" id="foregroundColorText"
                   value="<?= htmlspecialchars($b['foregroundColor'] ?? '#f8f5ee') ?>"
                   maxlength="7" placeholder="#rrggbb" style="font-family:monospace;width:90px"
                   oninput="syncFgColor(this)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="autoFgColor()"
                    title="Pick white or black based on theme color luminance">Auto</button>
            <span id="colorPreview" style="display:inline-flex;align-items:center;justify-content:center;
                  gap:6px;padding:5px 12px;border-radius:7px;font-size:.8rem;font-weight:600;
                  background:<?= htmlspecialchars(val($b, 'themeColor', $def)) ?>;
                  color:<?= htmlspecialchars($b['foregroundColor'] ?? '#f8f5ee') ?>">
              Aa preview
            </span>
          </div>
          <span class="field-hint">Used for header text, nav icons and buttons on the theme background.</span>
        </div>

        <div class="field">
          <label for="accentColor">Accent color <span style="font-weight:400;color:var(--muted);font-size:.78rem">(buttons, active tab, highlights)</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="color" id="accentColor" name="accentColor"
                   value="<?= htmlspecialchars($b['accentColor'] ?? '#52b788') ?>"
                   style="width:48px;height:36px;padding:2px;flex-shrink:0"
                   oninput="onAccentColorChange()">
            <input type="text" id="accentColorText"
                   value="<?= htmlspecialchars($b['accentColor'] ?? '#52b788') ?>"
                   maxlength="7" placeholder="#rrggbb" style="font-family:monospace;width:90px"
                   oninput="syncAccentColor(this)">
            <span id="accentPreview" style="display:inline-flex;align-items:center;justify-content:center;
                  gap:6px;padding:5px 14px;border-radius:7px;font-size:.8rem;font-weight:600;
                  background:<?= htmlspecialchars($b['accentColor'] ?? '#52b788') ?>;
                  color:<?= htmlspecialchars($b['foregroundColor'] ?? '#f8f5ee') ?>">
              Button
            </span>
          </div>
          <span class="field-hint">Applied to Today, Print and Share buttons and the active Week/Day tab.</span>
        </div>

        <div class="field span-2">
          <label for="theme">Visual theme</label>
          <?php
          $appCssDir   = __DIR__ . '/../app/';
          $cssFiles    = array_diff(array_map('basename', glob($appCssDir . '*.css') ?: []), ['overlap.css']);
          sort($cssFiles);
          $curTheme    = $b['theme'] ?? 'blockery';
          ?>
          <select id="theme" name="theme">
            <?php foreach ($cssFiles as $file):
              $name = pathinfo($file, PATHINFO_FILENAME); ?>
            <option value="<?= htmlspecialchars($name) ?>" <?= $curTheme === $name ? 'selected' : '' ?>>
              <?= htmlspecialchars(ucfirst($name)) ?>
            </option>
            <?php endforeach; ?>
            <?php if (empty($cssFiles)): ?>
            <option value="blockery" selected>Blockery (default)</option>
            <?php endif; ?>
          </select>
          <span class="field-hint">All <code>.css</code> files in <code>app/</code> (excluding overlap.css) appear here automatically. Drop your own <code>app/mytheme.css</code> to see it in this list.</span>
        </div>

        <div class="field">
          <label for="defaultLocation">Default location</label>
          <input type="text" id="defaultLocation" name="defaultLocation"
                 value="<?= htmlspecialchars(val($b, 'defaultLocation', $def)) ?>"
                 placeholder="<?= htmlspecialchars($def['defaultLocation']) ?>">
        </div>

        <div class="field">
          <label for="shareFilePrefix">Share file prefix</label>
          <input type="text" id="shareFilePrefix" name="shareFilePrefix"
                 value="<?= htmlspecialchars(val($b, 'shareFilePrefix', $def)) ?>"
                 placeholder="<?= htmlspecialchars($def['shareFilePrefix']) ?>">
          <span class="field-hint">Used in generated share image filenames.</span>
        </div>


      </div>
    </div>
  </div>

  <!-- Display settings -->
  <div class="card">
    <div class="card-header"><h3>Display settings</h3></div>
    <div class="card-body">
      <div class="form-grid cols-3">

        <div class="field">
          <label for="timeZone">Timezone</label>
          <select id="timeZone" name="timeZone">
            <?php
            $zones = ['Europe/Amsterdam','Europe/Brussels','Europe/London','Europe/Paris',
                      'UTC','America/New_York','America/Chicago','America/Los_Angeles'];
            $cur   = $d['timeZone'] ?? 'Europe/Amsterdam';
            foreach ($zones as $z): ?>
            <option value="<?= $z ?>" <?= $z === $cur ? 'selected' : '' ?>><?= $z ?></option>
            <?php endforeach; ?>
          </select>
        </div>

        <div class="field"><!-- spacer --></div>

        <div class="field">
          <label for="fontScale">Screen font scale</label>
          <input type="number" id="fontScale" name="fontScale"
                 min="0.5" max="3" step="0.1"
                 value="<?= number_format((float)($d['fontScale'] ?? 1), 1) ?>">
          <span class="field-hint">1 = no change</span>
        </div>

        <div class="field">
          <label for="printFontScale">Print font scale</label>
          <input type="number" id="printFontScale" name="printFontScale"
                 min="0.5" max="4" step="0.1"
                 value="<?= number_format((float)($d['printFontScale'] ?? 2), 1) ?>">
          <span class="field-hint">2 = twice as large</span>
        </div>

      </div>
    </div>
  </div>

  <!-- Filter keywords -->
  <div class="card">
    <div class="card-header">
      <h3>Filter keywords</h3>
      <button type="button" class="btn btn-secondary btn-sm" onclick="addKeyword()">+ Add</button>
    </div>
    <div class="card-body">
      <p style="font-size:.82rem;color:var(--muted);margin-bottom:12px">
        Events whose title <em>starts with</em> one of these keywords are <strong>filtered out</strong> and not shown in the schedule.
      </p>
      <div id="keywordList">
        <?php foreach ($kw as $word): ?>
        <div class="kw-tag" style="display:inline-flex;align-items:center;gap:4px;background:#e8f4ee;border:1px solid #c0dac8;border-radius:5px;padding:3px 8px;margin:3px;">
          <input type="text" name="filterKeywords[]" value="<?= htmlspecialchars($word) ?>"
                 style="border:none;background:transparent;font-size:.83rem;width:140px;outline:none">
          <button type="button" onclick="this.parentElement.remove()"
                  style="background:none;border:none;cursor:pointer;color:#c44;font-size:.85rem;padding:0 2px">✕</button>
        </div>
        <?php endforeach; ?>
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
const tc   = document.getElementById('themeColor');
const tt   = document.getElementById('themeColorText');
const fc   = document.getElementById('foregroundColor');
const ft   = document.getElementById('foregroundColorText');
const ac   = document.getElementById('accentColor');
const at   = document.getElementById('accentColorText');
const prev = document.getElementById('colorPreview');
const aprev = document.getElementById('accentPreview');

function updatePreview() {
  if (!prev) return;
  prev.style.background = tc ? tc.value : '#1a3d2b';
  prev.style.color      = fc ? fc.value : '#f8f5ee';
}
function updateAccentPreview() {
  if (!aprev) return;
  aprev.style.background = ac ? ac.value : '#52b788';
  aprev.style.color      = fc ? fc.value : '#f8f5ee';
}

function onThemeColorChange() {
  if (tt) tt.value = tc.value;
  updatePreview();
}
function onFgColorChange() {
  if (ft) ft.value = fc.value;
  updatePreview();
  updateAccentPreview();
}
function onAccentColorChange() {
  if (at) at.value = ac.value;
  updateAccentPreview();
}

function syncThemeColor(input) {
  if (/^#[0-9a-fA-F]{6}$/i.test(input.value) && tc) {
    tc.value = input.value;
    updatePreview();
  }
}
function syncFgColor(input) {
  if (/^#[0-9a-fA-F]{6}$/i.test(input.value) && fc) {
    fc.value = input.value;
    updatePreview();
    updateAccentPreview();
  }
}
function syncAccentColor(input) {
  if (/^#[0-9a-fA-F]{6}$/i.test(input.value) && ac) {
    ac.value = input.value;
    updateAccentPreview();
  }
}

// Auto: pick white or black based on relative luminance of the theme color
function autoFgColor() {
  if (!tc || !fc) return;
  const hex = tc.value.replace('#','');
  const r = parseInt(hex.slice(0,2),16)/255;
  const g = parseInt(hex.slice(2,4),16)/255;
  const b = parseInt(hex.slice(4,6),16)/255;
  // sRGB → linear luminance
  const lin = v => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  const lum = 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
  const chosen = lum > 0.179 ? '#1a1a1a' : '#ffffff';
  fc.value = chosen;
  if (ft) ft.value = chosen;
  updatePreview();
}

// When a file is chosen, clear the URL field (upload takes precedence)
const logoFile = document.getElementById('logoFile');
const logoUrl  = document.getElementById('logoUrl');
if (logoFile && logoUrl) {
  logoFile.addEventListener('change', () => { if (logoFile.files.length) logoUrl.value = ''; });
}
</script>
