#!/usr/bin/env bash
set -euo pipefail

account_root="/home/u133616505"
site_root="$account_root/domains/campusgig.net"
web_root="$site_root/public_html"
archive="$account_root/campusgig-release-1.0.2.zip"
release_dir="$(mktemp -d "$account_root/campusgig-release-1.0.2.XXXXXX")"
backup_dir="$account_root/deployment-backups/campusgig-1.0.2-$(date +%Y%m%d-%H%M%S)"

cleanup() {
  rm -rf "$release_dir"
}
trap cleanup EXIT

unzip -q "$archive" -d "$release_dir"

web_release="$release_dir/campusgig-hostinger/web/public_html"

test -f "$web_release/index.html"
test -f "$web_release/downloads/campusgig-android.apk"
test -f "$web_release/downloads/campusgig-android.apk.sha256"

mkdir -p "$backup_dir"
tar -czf "$backup_dir/web-before.tar.gz" --exclude='./api' -C "$web_root" .

cp -a "$web_release/." "$web_root/"

expected_hash="$(awk '{print $1}' "$web_root/downloads/campusgig-android.apk.sha256")"
actual_hash="$(sha256sum "$web_root/downloads/campusgig-android.apk" | awk '{print $1}')"
test "$expected_hash" = "$actual_hash"

printf 'DEPLOYMENT_OK\n'
printf 'BACKUP_DIR=%s\n' "$backup_dir"
printf 'APK_SHA256=%s\n' "$actual_hash"
