#!/usr/bin/env bash
set -euo pipefail

account_root="/home/u133616505"
site_root="$account_root/domains/campusgig.net"
web_root="$site_root/public_html"
api_root="$site_root/laravel-api"
archive="$account_root/campusgig-release-1.0.1.zip"
release_dir="$(mktemp -d "$account_root/campusgig-release-1.0.1.XXXXXX")"
backup_dir="$account_root/deployment-backups/campusgig-1.0.1-$(date +%Y%m%d-%H%M%S)"

cleanup() {
  rm -rf "$release_dir"
}
trap cleanup EXIT

unzip -q "$archive" -d "$release_dir"

bundle_root="$release_dir/campusgig-hostinger"
web_release="$bundle_root/web/public_html"
api_release="$bundle_root/api/laravel-api"

test -f "$web_release/index.html"
test -f "$web_release/downloads/campusgig-android.apk"
test -f "$web_release/downloads/campusgig-android.apk.sha256"
test -f "$api_release/app/Http/Controllers/AuthController.php"
test -f "$api_root/.env"
test -d "$api_root/vendor"
test -d "$api_root/storage"

mkdir -p "$backup_dir"
tar -czf "$backup_dir/web-before.tar.gz" --exclude='./api' -C "$web_root" .
cp "$api_root/app/Http/Controllers/AuthController.php" "$backup_dir/AuthController.php"

cp -a "$web_release/." "$web_root/"
cp "$api_release/app/Http/Controllers/AuthController.php" "$api_root/app/Http/Controllers/AuthController.php"

php -l "$api_root/app/Http/Controllers/AuthController.php"
(cd "$api_root" && php artisan optimize:clear)

expected_hash="$(awk '{print $1}' "$web_root/downloads/campusgig-android.apk.sha256")"
actual_hash="$(sha256sum "$web_root/downloads/campusgig-android.apk" | awk '{print $1}')"
test "$expected_hash" = "$actual_hash"

printf 'DEPLOYMENT_OK\n'
printf 'BACKUP_DIR=%s\n' "$backup_dir"
printf 'APK_SHA256=%s\n' "$actual_hash"
