#!/usr/bin/env bash

set -euo pipefail

readonly APP_DIRECTORY="/home/u133616505/domains/campusgig.net/laravel-api"
readonly ENV_FILE="${APP_DIRECTORY}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Production environment file was not found." >&2
    exit 1
fi

read -r -s -p "Hostinger MySQL password: " database_password
printf '\n'

if [[ -z "${database_password}" ]]; then
    echo "Password cannot be empty." >&2
    exit 1
fi

if ! printf '%s' "${database_password}" | php -r '
    $password = stream_get_contents(STDIN);
    try {
        new PDO(
            "mysql:host=localhost;port=3306;dbname=u133616505_campusgig;charset=utf8mb4",
            "u133616505_cg_api",
            $password,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    } catch (Throwable $exception) {
        fwrite(STDERR, "Database login failed. Verify the saved Hostinger password.\n");
        exit(1);
    }
'; then
    unset database_password
    exit 1
fi

printf '%s' "${database_password}" | TARGET_ENV_FILE="${ENV_FILE}" php -r '
    $path = getenv("TARGET_ENV_FILE");
    $password = stream_get_contents(STDIN);
    $escaped = str_replace(["\\", "\"", "\r", "\n"], ["\\\\", "\\\"", "", ""], $password);
    $contents = file_get_contents($path);
    if ($contents === false) {
        fwrite(STDERR, "Unable to read the environment file.\n");
        exit(1);
    }
    $updated = preg_replace("/^DB_PASSWORD=.*$/m", "DB_PASSWORD=\"" . $escaped . "\"", $contents, 1, $count);
    if ($updated === null || $count !== 1 || file_put_contents($path, $updated, LOCK_EX) === false) {
        fwrite(STDERR, "Unable to update the environment file.\n");
        exit(1);
    }
'

unset database_password
chmod 600 "${ENV_FILE}"
echo "Database connection verified and saved securely."
