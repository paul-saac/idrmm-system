#!/usr/bin/env bash
# Reproducible client-only installation in the Linux runtime, not on the laptop.
set -euo pipefail
if [[ "$(id -u)" != 0 ]] || ! command -v apt-get >/dev/null; then
  echo 'PostgreSQL clients are missing. This runtime needs root and apt-get to provision them; use an image with PostgreSQL 18 clients preinstalled otherwise.' >&2
  exit 1
fi
. /etc/os-release
case "${ID:-}:${VERSION_CODENAME:-}" in
  debian:bookworm|debian:trixie|ubuntu:jammy|ubuntu:noble|ubuntu:resolute) ;;
  *) echo 'This Linux distribution is not supported by this installer. Provision PostgreSQL 18 clients in the runtime image.' >&2; exit 1 ;;
esac
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::Retries=3 update
apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates curl gnupg

# Use PostgreSQL's signed repository; never disable TLS or signature checks.
key_file="$(mktemp)"
trap 'rm -f -- "$key_file"' EXIT
curl --fail --silent --show-error --location --retry 3 --proto '=https' --proto-redir '=https' \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key_file"
fingerprint="$(gpg --batch --show-keys --with-colons "$key_file" | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ "$fingerprint" != B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]]; then
  echo 'PostgreSQL repository signing key did not match the expected fingerprint.' >&2
  exit 1
fi
install -d /usr/share/postgresql-common/pgdg
install -m 644 "$key_file" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/idrmm-pgdg.list
apt-get -o Acquire::Retries=3 update
apt-get -o Acquire::Retries=3 install -y --no-install-recommends postgresql-client-18
/usr/lib/postgresql/18/bin/pg_dump --version
/usr/lib/postgresql/18/bin/psql --version
