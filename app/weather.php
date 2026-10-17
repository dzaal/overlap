<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: public, max-age=1800');

$lat = filter_input(INPUT_GET, 'lat', FILTER_VALIDATE_FLOAT);
$lon = filter_input(INPUT_GET, 'lon', FILTER_VALIDATE_FLOAT);
$lat = $lat !== false && $lat !== null ? max(-90.0, min(90.0, $lat)) : 52.3608;
$lon = $lon !== false && $lon !== null ? max(-180.0, min(180.0, $lon)) : 4.9487;

$cacheKey = hash('sha256', sprintf('v6,%.4f,%.4f', $lat, $lon));
$cacheFile = sys_get_temp_dir() . '/overlap_weather_' . $cacheKey . '.json';
$staleFiles = [];
foreach (['v6', 'v5', 'v4', 'v3', 'v2'] as $version) {
    $key = hash('sha256', sprintf('%s,%.4f,%.4f', $version, $lat, $lon));
    $staleFiles[] = sys_get_temp_dir() . '/overlap_weather_' . $key . '.json';
}

function outputStaleWeather(array $files): bool
{
    foreach ($files as $file) {
        if (!is_file($file)) {
            continue;
        }
        $contents = file_get_contents($file);
        $cached = $contents !== false ? json_decode($contents, true) : null;
        if (!empty($cached['hourly']['time'])) {
            header('Warning: 110 - "stale weather response"');
            echo $contents;
            return true;
        }
    }
    return false;
}
if (is_file($cacheFile) && time() - filemtime($cacheFile) < 1800) {
    readfile($cacheFile);
    exit;
}

$query = http_build_query([
    'latitude' => $lat,
    'longitude' => $lon,
    'hourly' => 'temperature_2m,weather_code',
    'timezone' => 'Europe/Amsterdam',
    'past_days' => 92,
    'forecast_days' => 16,
]);
$url = 'https://api.open-meteo.com/v1/forecast?' . $query;
$context = stream_context_create(['http' => ['timeout' => 25, 'ignore_errors' => true]]);
$json = @file_get_contents($url, false, $context);

$data = $json !== false ? json_decode($json, true) : null;
if (!is_array($data) || empty($data['hourly']['time'])) {
    if (outputStaleWeather($staleFiles)) {
        exit;
    }
    http_response_code(502);
    echo json_encode(['error' => 'Weather service unavailable']);
    exit;
}

$times = $data['hourly']['time'] ?? [];
$temperatures = $data['hourly']['temperature_2m'] ?? [];
$codes = $data['hourly']['weather_code'] ?? [];
$filtered = ['time' => [], 'temperature_2m' => [], 'weather_code' => []];
foreach ($times as $index => $stamp) {
    $hour = (int) substr((string) $stamp, 11, 2);
    if (!in_array($hour, [10, 13, 16, 19], true)) {
        continue;
    }
    $filtered['time'][] = $stamp;
    $filtered['temperature_2m'][] = $temperatures[$index] ?? null;
    $filtered['weather_code'][] = $codes[$index] ?? null;
}

$response = json_encode(['hourly' => $filtered], JSON_UNESCAPED_SLASHES);
if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Weather response could not be encoded']);
    exit;
}

@file_put_contents($cacheFile, $response, LOCK_EX);
echo $response;
