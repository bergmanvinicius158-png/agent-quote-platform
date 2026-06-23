#!/bin/bash
# 部署后健康检查（在服务器上运行）
set -euo pipefail

BASE="${1:-http://127.0.0.1:3456}"

check() {
  local path="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  if [ "$code" = "200" ]; then
    echo "OK  $path ($code)"
  else
    echo "FAIL $path ($code)"
    exit 1
  fi
}

echo "Checking $BASE ..."
check "/"
check "/admin/login.html"
check "/api/platform"
check "/api/pricing"
check "/images/foundex-logo.png"
check "/images/foundex-logo-light.png"
check "/css/brand.css"

if systemctl is-active --quiet agent-quote 2>/dev/null; then
  echo "OK  systemd agent-quote (active)"
else
  echo "WARN systemd agent-quote not active (local dev?)"
fi

echo "All checks passed."
