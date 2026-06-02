<?php
declare(strict_types=1);

/**
 * Auth — simple session-based authentication for the Overlap admin panel.
 * Credentials are stored in lib/credentials.php as a PHP return statement
 * (PHP executes it harmlessly if accessed via the web; no plain-text exposure).
 */
class Auth
{
    private static string $credFile = __DIR__ . '/credentials.php';

    // ── Public API ────────────────────────────────────────────────────────────

    public static function isInstalled(): bool
    {
        return file_exists(self::$credFile);
    }

    /**
     * Call at the top of every protected page.
     * Redirects to install.php if not set up yet, or login.php if not logged in.
     */
    public static function requireLogin(): void
    {
        if (!self::isInstalled()) {
            $base = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/');
            header('Location: ' . $base . '/install.php');
            exit;
        }
        self::startSession();
        if (!self::isLoggedIn()) {
            $loginUrl = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/login.php';
            header('Location: ' . $loginUrl . '?next=' . urlencode($_SERVER['REQUEST_URI']));
            exit;
        }
    }

    public static function isLoggedIn(): bool
    {
        self::startSession();
        return !empty($_SESSION['overlap_auth']);
    }

    public static function getUsername(): string
    {
        self::startSession();
        return (string)($_SESSION['overlap_user'] ?? '');
    }

    public static function login(string $username, string $password): bool
    {
        if (!self::isInstalled()) return false;
        $creds = require self::$credFile;
        if (!is_array($creds)) return false;
        if (strcasecmp($username, $creds['username'] ?? '') !== 0) return false;
        if (!password_verify($password, $creds['hash'] ?? '')) return false;
        self::startSession();
        session_regenerate_id(true);
        $_SESSION['overlap_auth'] = true;
        $_SESSION['overlap_user'] = $creds['username'];
        return true;
    }

    public static function logout(): void
    {
        self::startSession();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    /**
     * Hash and persist credentials.
     * Throws RuntimeException if the file cannot be written.
     */
    public static function setCredentials(string $username, string $password): void
    {
        $hash    = password_hash($password, PASSWORD_DEFAULT);
        $content = "<?php\nreturn " . var_export(['username' => $username, 'hash' => $hash], true) . ";\n";
        if (file_put_contents(self::$credFile, $content) === false) {
            throw new RuntimeException('Cannot write credentials file: ' . self::$credFile);
        }
        @chmod(self::$credFile, 0640);
    }

    public static function csrfToken(): string
    {
        self::startSession();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
        }
        return $_SESSION['csrf'];
    }

    public static function verifyCsrf(string $token): bool
    {
        self::startSession();
        return isset($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private static bool $started = false;

    private static function startSession(): void
    {
        if (self::$started || session_status() === PHP_SESSION_ACTIVE) {
            self::$started = true;
            return;
        }
        session_name('overlap_admin');
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => isset($_SERVER['HTTPS']),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
        self::$started = true;
    }
}
