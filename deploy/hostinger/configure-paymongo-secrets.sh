#!/usr/bin/env bash

set -euo pipefail

readonly ENV_FILE="/home/u133616505/domains/campusgig.net/laravel-api/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Production environment file was not found." >&2
    exit 1
fi

read -r -s -p "PayMongo live secret key (sk_live_...): " paymongo_secret_key
printf '\n'
if [[ "${paymongo_secret_key}" != sk_live_* ]]; then
    unset paymongo_secret_key
    echo "A PayMongo live secret key beginning with sk_live_ is required." >&2
    exit 1
fi

read -r -s -p "PayMongo live webhook secret: " paymongo_webhook_secret
printf '\n'
if (( ${#paymongo_webhook_secret} < 12 )); then
    unset paymongo_secret_key paymongo_webhook_secret
    echo "The PayMongo webhook secret is invalid." >&2
    exit 1
fi

update_env_value() {
    local key="$1"
    local value="$2"

    printf '%s' "${value}" | TARGET_ENV_FILE="${ENV_FILE}" ENV_KEY="${key}" php -r '
        $path = getenv("TARGET_ENV_FILE");
        $key = getenv("ENV_KEY");
        $value = stream_get_contents(STDIN);
        $escaped = str_replace(["\\", "\"", "\r", "\n"], ["\\\\", "\\\"", "", ""], $value);
        $contents = file_get_contents($path);
        if ($contents === false) {
            fwrite(STDERR, "Unable to read the environment file.\n");
            exit(1);
        }
        $pattern = "/^" . preg_quote($key, "/") . "=.*$/m";
        $replacement = $key . "=\"" . $escaped . "\"";
        $updated = preg_replace($pattern, $replacement, $contents, 1, $count);
        if ($updated === null || $count !== 1 || file_put_contents($path, $updated, LOCK_EX) === false) {
            fwrite(STDERR, "Unable to update " . $key . ".\n");
            exit(1);
        }
    '
}

update_env_value "PAYMONGO_SECRET_KEY" "${paymongo_secret_key}"
update_env_value "PAYMONGO_WEBHOOK_SECRET" "${paymongo_webhook_secret}"

unset paymongo_secret_key paymongo_webhook_secret
chmod 600 "${ENV_FILE}"
echo "PayMongo live secrets saved securely."
