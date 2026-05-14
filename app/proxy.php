<?php
// proxy.php — fetches ICS calendar feeds on behalf of the browser (avoids CORS)
// Allowed URLs are read from overlap-config.js (no hard-coded whitelist needed)

$requestedUrl = isset($_GET['url']) ? trim($_GET['url']) : null;

// Fallback to main config URL if none given
if (!$requestedUrl) {
    http_response_code(400);
    die('Geen URL opgegeven.');
}

// ── Build allowed list from config ───────────────────────────────────────────
function getAllowedUrls(): array
{
    $configFile = __DIR__ . '/overlap-config.js';
    if (!file_exists($configFile)) {
        // Fallback: allow any Google Calendar ICS
        return ['https://calendar.google.com/calendar/ical/'];
    }

    $js = file_get_contents($configFile);

    // Extract string values that look like ICS URLs
    preg_match_all("/'(https?:\/\/[^']+\.ics[^']*)'/i", $js, $m);
    $urls = $m[1] ?? [];

    // Also allow Google Calendar as a prefix (covers URL-encoded variants)
    $urls[] = 'https://calendar.google.com/calendar/ical/';

    return array_unique($urls);
}

$allowed = false;
foreach (getAllowedUrls() as $entry) {
    // Allow if the requested URL starts with the entry (prefix match)
    // or is exactly equal (full match)
    $decoded = urldecode($requestedUrl);
    if (
        strpos($requestedUrl, $entry) === 0 ||
        strpos($decoded,      $entry) === 0 ||
        $requestedUrl === $entry
    ) {
        $allowed = true;
        break;
    }
}

if (!$allowed) {
    http_response_code(403);
    die('URL niet toegestaan.');
}

// ── Cache ────────────────────────────────────────────────────────────────────
$cacheDir  = sys_get_temp_dir();
$cacheFile = $cacheDir . '/overlap_ics_' . md5($requestedUrl) . '.txt';
$cacheTtl  = 900; // 15 minutes

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTtl) {
    $data = file_get_contents($cacheFile);
} else {
    $ctx = stream_context_create(['http' => [
        'timeout'    => 10,
        'user_agent' => 'Overlap-Rooster/1.0',
        'follow_location' => true,
        'max_redirects'   => 5,
    ]]);
    $data = @file_get_contents($requestedUrl, false, $ctx);

    if ($data !== false) {
        file_put_contents($cacheFile, $data);
    } elseif (file_exists($cacheFile)) {
        $data = file_get_contents($cacheFile); // stale cache fallback
    } else {
        http_response_code(502);
        die('Kon agenda niet ophalen.');
    }
}

header('Content-Type: text/calendar; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: max-age=900, public');
echo $data;
