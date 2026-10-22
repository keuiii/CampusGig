#!/usr/bin/env bash

set -euo pipefail

readonly APP_DIRECTORY="/home/u133616505/domains/campusgig.net/laravel-api"
readonly ENV_FILE="${APP_DIRECTORY}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Production environment file was not found." >&2
    exit 1
fi

read -r -s -p "Password for no-reply@campusgig.net: " mailbox_password
printf '\n'
if [[ -z "${mailbox_password}" ]]; then
    echo "Mailbox password cannot be empty." >&2
    exit 1
fi

read -r -p "Email address that should receive the test message: " test_recipient
if ! TEST_RECIPIENT="${test_recipient}" php -r '
    exit(filter_var(getenv("TEST_RECIPIENT"), FILTER_VALIDATE_EMAIL) ? 0 : 1);
'; then
    unset mailbox_password test_recipient
    echo "Enter a valid test recipient email address." >&2
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

update_env_value "MAIL_MAILER" "smtp"
update_env_value "MAIL_HOST" "smtp.hostinger.com"
update_env_value "MAIL_PORT" "465"
update_env_value "MAIL_USERNAME" "no-reply@campusgig.net"
update_env_value "MAIL_PASSWORD" "${mailbox_password}"
update_env_value "MAIL_SCHEME" "smtps"
update_env_value "MAIL_FROM_ADDRESS" "no-reply@campusgig.net"
update_env_value "MAIL_FROM_NAME" "CampusGig"

unset mailbox_password
chmod 600 "${ENV_FILE}"

cd "${APP_DIRECTORY}"
php artisan config:clear --quiet

if ! TEST_RECIPIENT="${test_recipient}" php -r '
    require "vendor/autoload.php";
    $app = require "bootstrap/app.php";
    $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    try {
        \Illuminate\Support\Facades\Mail::raw(
            "CampusGig production email delivery is configured successfully.",
            function ($message): void {
                $message->to(getenv("TEST_RECIPIENT"))->subject("CampusGig email test");
            }
        );
    } catch (Throwable $exception) {
        fwrite(STDERR, "SMTP authentication or delivery failed. Verify the mailbox password and retry.\n");
        exit(1);
    }
'; then
    unset test_recipient
    exit 1
fi

echo "Production email configured and test message sent to ${test_recipient}."
unset test_recipient
