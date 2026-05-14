<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=UTF-8');

require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/CalendarDiagnostics.php';

$action = $_POST['action'] ?? $_GET['action'] ?? '';

try {
    switch ($action) {

        case 'test_calendar':
            $url = trim($_POST['url'] ?? '');
            if (!$url) {
                echo json_encode(['error' => true, 'message' => 'Geen URL opgegeven.']);
                exit;
            }
            // Basic URL validation
            if (!filter_var($url, FILTER_VALIDATE_URL) && !preg_match('/^webcal:\/\//i', $url)) {
                echo json_encode(['error' => true, 'message' => 'Ongeldige URL.']);
                exit;
            }
            $result = CalendarDiagnostics::diagnose($url);
            echo json_encode($result);
            break;

        case 'config':
            $cfg = Config::read();
            // Strip sensitive keys from public output
            unset($cfg['defaults']['googleApiKey'], $cfg['defaults']['googleClientId']);
            echo json_encode($cfg);
            break;

        default:
            http_response_code(400);
            echo json_encode(['error' => true, 'message' => 'Onbekende actie.']);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => true, 'message' => $e->getMessage()]);
}
