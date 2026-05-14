<?php
declare(strict_types=1);

class Config
{
    const CONFIG_PATH = __DIR__ . '/../app/overlap-config.js';

    // ── Read ─────────────────────────────────────────────────────────────────

    public static function read(): array
    {
        $js = @file_get_contents(self::CONFIG_PATH);
        if ($js === false) {
            throw new RuntimeException('Cannot read config: ' . self::CONFIG_PATH);
        }
        return self::parseJsConfig($js);
    }

    // ── Write ────────────────────────────────────────────────────────────────

    public static function write(array $config): void
    {
        // Keep a backup
        if (file_exists(self::CONFIG_PATH)) {
            @copy(self::CONFIG_PATH, self::CONFIG_PATH . '.bak');
        }
        $js = self::generateJsConfig($config);
        if (file_put_contents(self::CONFIG_PATH, $js, LOCK_EX) === false) {
            throw new RuntimeException('Cannot write config');
        }
    }

    // ── Parse JS → PHP array ─────────────────────────────────────────────────

    public static function parseJsConfig(string $js): array
    {
        // Extract only the first complete {...} object — ignore anything after it
        // (aliases, comments, etc. at the end of the file)
        $start = strpos($js, '{');
        if ($start === false) {
            throw new RuntimeException('No JSON object found in config file');
        }
        // Find matching closing brace
        $depth = 0;
        $end   = $start;
        $len   = strlen($js);
        for ($i = $start; $i < $len; $i++) {
            if ($js[$i] === '{') $depth++;
            elseif ($js[$i] === '}') {
                $depth--;
                if ($depth === 0) { $end = $i; break; }
            }
        }
        $js = substr($js, $start, $end - $start + 1);

        // Strip comments (state-machine aware of strings)
        $js = self::stripComments($js);

        // Quote unquoted object keys:  key:  →  "key":
        $js = preg_replace('/([{,\s\n\r])([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*):/m', '$1"$2"$3:', $js);

        // Convert single-quoted strings → double-quoted
        $js = preg_replace_callback(
            "/'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'/s",
            fn($m) => '"' . str_replace(['"', "\\'"], ['\\"', "'"], $m[1]) . '"',
            $js
        );

        // Remove trailing commas before } or ]
        $js = preg_replace('/,(\s*[}\]])/s', '$1', $js);

        $data = json_decode($js, true);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException('JSON parse error: ' . json_last_error_msg() . "\n\nInput:\n" . substr($js, 0, 500));
        }
        return $data ?? [];
    }

    private static function stripComments(string $js): string
    {
        $out = '';
        $i   = 0;
        $len = strlen($js);

        while ($i < $len) {
            $c = $js[$i];

            // Inside a string — pass through verbatim
            if ($c === '"' || $c === "'") {
                $q = $c;
                $out .= $c;
                $i++;
                while ($i < $len) {
                    $c = $js[$i];
                    $out .= $c;
                    if ($c === '\\' && $i + 1 < $len) {
                        $out .= $js[++$i]; // escaped char
                    } elseif ($c === $q) {
                        break; // end of string
                    }
                    $i++;
                }
                $i++;
                continue;
            }

            // Line comment
            if ($c === '/' && $i + 1 < $len && $js[$i + 1] === '/') {
                while ($i < $len && $js[$i] !== "\n") {
                    $i++;
                }
                continue;
            }

            // Block comment
            if ($c === '/' && $i + 1 < $len && $js[$i + 1] === '*') {
                $i += 2;
                while ($i < $len - 1 && !($js[$i] === '*' && $js[$i + 1] === '/')) {
                    $i++;
                }
                $i += 2;
                continue;
            }

            $out .= $c;
            $i++;
        }
        return $out;
    }

    // ── Generate JS ──────────────────────────────────────────────────────────

    public static function generateJsConfig(array $cfg): string
    {
        $b    = $cfg['branding'] ?? [];
        $crew = $cfg['crew']     ?? [];
        $d    = $cfg['defaults'] ?? [];

        $out  = "window.OVERLAP_CONFIG = {\n\n";

        $out .= "  // ── BRANDING ─────────────────────────────────────────────────────────────\n";
        $out .= "  branding: {\n";
        foreach ($b as $k => $v) {
            $out .= sprintf("    %-22s %s,\n", $k . ':', self::jsVal($v));
        }
        $out .= "  },\n\n";

        $out .= "  // ── CREW ─────────────────────────────────────────────────────────────────\n";
        $out .= "  crew: [\n";
        foreach ($crew as $m) {
            $line  = "{name: " . self::jsVal($m['name'] ?? '') . ", color: " . self::jsVal($m['color'] ?? '#999');
            if (!empty($m['bday'])) {
                $line .= ", bday: " . self::jsVal($m['bday']);
            }
            $line .= '}';
            $out  .= "    $line,\n";
        }
        $out .= "  ],\n\n";

        $out .= "  // ── DEFAULTS & API KEYS ──────────────────────────────────────────────────\n";
        $out .= "  defaults: {\n";
        foreach ($d as $k => $v) {
            if ($k === 'importantDates' && is_array($v)) {
                // Array of {date, label} objects
                if (empty($v)) {
                    $out .= sprintf("    %-30s [],\n", $k . ':');
                } else {
                    $out .= "    " . $k . ": [\n";
                    foreach ($v as $entry) {
                        $line  = "{date: " . self::jsVal($entry['date'] ?? '');
                        if (!empty($entry['endDate'])) {
                            $line .= ", endDate: " . self::jsVal($entry['endDate']);
                        }
                        $line .= ", label: " . self::jsVal($entry['label'] ?? '') . "}";
                        $out  .= "      $line,\n";
                    }
                    $out .= "    ],\n";
                }
            } elseif ($k === 'alwaysShowDays' && is_array($v)) {
                // Array of ints
                $arr  = '[' . implode(', ', array_map('intval', $v)) . ']';
                $out .= sprintf("    %-30s %s,\n", $k . ':', $arr);
            } elseif (is_array($v)) {
                // Generic array (e.g. filterKeywords)
                $arr  = '[' . implode(', ', array_map([self::class, 'jsVal'], $v)) . ']';
                $out .= sprintf("    %-30s %s,\n", $k . ':', $arr);
            } else {
                $out .= sprintf("    %-30s %s,\n", $k . ':', self::jsVal($v));
            }
        }
        $out .= "  }\n";
        $out .= "};\n";
        $out .= "\n// overlap.js reads ROOSTER_CONFIG internally — keep this alias\n";
        $out .= "window.ROOSTER_CONFIG = window.OVERLAP_CONFIG;\n";

        return $out;
    }

    private static function jsVal(mixed $v): string
    {
        if (is_bool($v))   return $v ? 'true' : 'false';
        if (is_null($v))   return 'null';
        if (is_int($v) || is_float($v)) return (string)$v;
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], (string)$v) . "'";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Return all configured calendar URLs as [label => url] */
    public static function calendarUrls(array $cfg): array
    {
        $d    = $cfg['defaults'] ?? [];
        $urls = [];

        $known = [
            'calendarUrl'          => 'Hoofdrooster',
            'appointmentUrl'       => 'Afspraken',
            'mainEventCalendarUrl' => 'Evenementen',
            'schoolHolidayCalendarUrl' => 'Schoolvakanties',
        ];
        foreach ($known as $key => $label) {
            if (!empty($d[$key])) {
                $urls[$key] = ['label' => $label, 'url' => $d[$key]];
            }
        }
        foreach ($cfg['calendars'] ?? [] as $i => $cal) {
            if (!empty($cal['url'])) {
                $urls['extra_' . $i] = [
                    'label' => $cal['name'] ?? 'Agenda ' . ($i + 1),
                    'url'   => $cal['url'],
                ];
            }
        }
        return $urls;
    }
}
