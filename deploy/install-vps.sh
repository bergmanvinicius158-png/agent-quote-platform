#!/bin/bash
# 国内云 Ubuntu 22.04+ 一键部署脚本
# 用法: sudo bash deploy/install-vps.sh
# 环境变量（可选）:
#   REPO_URL   Git 仓库地址
#   APP_DIR    安装目录，默认 /opt/agent-quote-platform
#   DOMAIN     Nginx server_name（域名或公网 IP）
#   ADMIN_PASSWORD  管理后台密码（未设置则交互输入）

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/bergmanvinicius158-png/agent-quote-platform.git}"
APP_DIR="${APP_DIR:-/opt/agent-quote-platform}"
DOMAIN="${DOMAIN:-_}"
NODE_MAJOR="${NODE_MAJOR:-20}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 运行: sudo bash deploy/install-vps.sh"
  exit 1
fi

echo "==> 更新系统并安装依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ca-certificates

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  echo "==> 安装 Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> Node $(node -v)"

echo "==> 部署代码到 $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull origin main || git pull origin master
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

mkdir -p data/agents "$APP_DIR/public/images"
chmod -R u+rwX data

if [ ! -f "$APP_DIR/.env" ]; then
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    read -rsp "设置 ADMIN_PASSWORD（管理后台密码）: " ADMIN_PASSWORD
    echo
  fi
  if [ ${#ADMIN_PASSWORD} -lt 8 ]; then
    echo "密码至少 8 位"
    exit 1
  fi
  cat > "$APP_DIR/.env" <<EOF
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=3456
EOF
  chmod 600 "$APP_DIR/.env"
  echo "已创建 $APP_DIR/.env"
else
  echo "保留现有 .env"
fi

echo "==> 安装 systemd 服务"
cp "$APP_DIR/deploy/agent-quote.service" /etc/systemd/system/agent-quote.service
chown -R www-data:www-data "$APP_DIR/data"
systemctl daemon-reload
systemctl enable agent-quote
systemctl restart agent-quote

echo "==> 配置 Nginx"
NGINX_CONF="/etc/nginx/sites-available/agent-quote"
sed "s/YOUR_DOMAIN/${DOMAIN}/g" "$APP_DIR/deploy/nginx-agent-quote.conf" > "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/agent-quote
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> 安装备份脚本与 cron"
cp "$APP_DIR/deploy/backup-quote.sh" /opt/backup-quote.sh
chmod +x /opt/backup-quote.sh
mkdir -p /var/backups/agent-quote-platform
CRON_LINE="0 3 * * * /opt/backup-quote.sh"
( crontab -l 2>/dev/null | grep -v backup-quote.sh; echo "$CRON_LINE" ) | crontab -

echo "==> 健康检查"
sleep 2
bash "$APP_DIR/deploy/verify.sh" "http://127.0.0.1:3456"

PUBLIC_IP="$(curl -s --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "=========================================="
echo "  部署完成"
echo "  报价页:     http://${PUBLIC_IP}/"
echo "  管理后台:   http://${PUBLIC_IP}/admin/login.html"
echo "  服务状态:   systemctl status agent-quote"
echo "  HTTPS:      certbot --nginx -d 你的域名"
echo "  安全组:     放行 22 / 80 / 443，勿开放 3456"
echo "=========================================="
