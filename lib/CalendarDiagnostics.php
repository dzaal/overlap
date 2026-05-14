<?php
declare(strict_types=1);

class CalendarDiagnostics
{
    const FETCH_TIMEOUT = 12;

    // ── Public API ───────────────────────────────────────────────────────────

    /** Fetch + parse an ICS URL and return full diagnostics. */
    public static function diagnose(string $url): array
    {
        $result = self::fetchICS($url);
        if ($result['error']) {
            return $result;
        }

        $events = self::parseICS($result['content']);
        $stats  = self::computeStats($events);

        return array_merge($result, [
            'error'      => false,
            'eventCount' => count($events),
            'stats'      => $stats,
            'events'     => array_slice($events, 0, 5), // sample only
        ]);
    }

    // ── Fetch ────────────────────────────────────────────────────────────────

    public static function fetchICS(string $url): array
    {
        // Normalise webcal:// → https://
        $url = preg_replace('/^webcal:\/\//i', 'https://', $url);

        $ctx = stream_context_create([
            'http' => [
                'timeout'     => self::FETCH_TIMEOUT,
                'user_agent'  => 'Overlap-Manager/1.0',
                'follow_location' => true,
                'max_redirects'   => 5,
            ],
            'ssl'  => [
                'verify_peer'      => true,
                'verify_peer_name' => true,
            ],
        ]);

        $t0      = microtime(true);
        $content = @file_get_contents($url, false, $ctx);
        $elapsed = round((microtime(true) - $t0) * 1000);

        if ($content === false) {
            return [
                'error'   => true,
                'message' => 'Kon URL niet ophalen. Controleer de URL en netwerktoegang.',
                'url'     => $url,
                'ms'      => $elapsed,
            ];
        }

        if (stripos($content, 'BEGIN:VCALENDAR') === false) {
            return [
                'error'   => true,
                'message' => 'Geen geldig ICS-bestand (BEGIN:VCALENDAR ontbreekt).',
                'url'     => $url,
                'ms'      => $elapsed,
                'preview' => substr($content, 0, 200),
            ];
        }

        return [
            'error'   => false,
            'url'     => $url,
            'ms'      => $elapsed,
            'bytes'   => strlen($content),
            'content' => $content,
        ];
    }

    // ── Parse ICS ────────────────────────────────────────────────────────────

    public static function parseICS(string $content): array
    {
        // Unfold long lines (RFC 5545 line folding)
        $content = preg_replace("/\r\n[ \t]/", '', $content);
        $content = preg_replace("/\n[ \t]/", '', $content);

        $events  = [];
        $current = null;

        foreach (explode("\n", $content) as $line) {
            $line = rtrim($line, "\r");

            if ($line === 'BEGIN:VEVENT') {
                $current = [];
                continue;
            }
            if ($line === 'END:VEVENT' && $current !== null) {
                $events[] = $current;
                $current  = null;
                continue;
            }
            if ($current === null) {
                continue;
            }

            // Split property name (with possible params) from value
            $colon = strpos($line, ':');
            if ($colon === false) continue;

            $prop  = substr($line, 0, $colon);
            $value = substr($line, $colon + 1);

            // Strip parameters (e.g. DTSTART;TZID=Europe/Amsterdam)
            $propName = strtoupper(explode(';', $prop)[0]);

            switch ($propName) {
                case 'SUMMARY':
                    $current['summary'] = self::unescape($value);
                    break;
                case 'DTSTART':
                    $current['start'] = self::parseDate($value);
                    break;
                case 'DTEND':
                    $current['end'] = self::parseDate($value);
                    break;
                case 'DURATION':
                    $current['duration'] = $value;
                    break;
                case 'DESCRIPTION':
                    $current['description'] = self::unescape($value);
                    break;
                case 'LOCATION':
                    $current['location'] = self::unescape($value);
                    break;
                case 'STATUS':
                    $current['status'] = $value;
                    break;
                case 'CATEGORIES':
                    $current['categories'] = array_map('trim', explode(',', $value));
                    break;
                case 'UID':
                    $current['uid'] = $value;
                    break;
            }
        }

        return $events;
    }

    // ── Stats ────────────────────────────────────────────────────────────────

    public static function computeStats(array $events): array
    {
        if (empty($events)) {
            return [
                'total'    => 0,
                'earliest' => null,
                'latest'   => null,
                'upcoming' => 0,
                'past'     => 0,
                'today'    => date('Y-m-d'),
            ];
        }

        $today    = date('Y-m-d');
        $upcoming = 0;
        $past     = 0;
        $dates    = [];

        foreach ($events as $ev) {
            $d = $ev['start'] ?? null;
            if ($d) {
                $dates[] = $d;
                if ($d >= $today) {
                    $upcoming++;
                } else {
                    $past++;
                }
            }
        }

        sort($dates);

        // Sample summaries (unique, up to 8)
        $summaries = array_unique(array_filter(array_column($events, 'summary')));
        sort($summaries);

        return [
            'total'    => count($events),
            'earliest' => $dates[0]              ?? null,
            'latest'   => end($dates) ?: null,
            'upcoming' => $upcoming,
            'past'     => $past,
            'today'    => $today,
            'samples'  => array_values(array_slice($summaries, 0, 8)),
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static function parseDate(string $raw): ?string
    {
        // YYYYMMDDTHHMMSS[Z] or YYYYMMDD
        $raw = preg_replace('/[TZ].*/', '', $raw); // strip time part
        if (preg_match('/^(\d{4})(\d{2})(\d{2})$/', $raw, $m)) {
            return "{$m[1]}-{$m[2]}-{$m[3]}";
        }
        return null;
    }

    private static function unescape(string $s): string
    {
        return str_replace(['\\n', '\\,', '\\;', '\\\\'], ["\n", ',', ';', '\\'], $s);
    }
}
