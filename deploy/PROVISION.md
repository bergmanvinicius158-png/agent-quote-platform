# 国内云 VPS 采购与网络配置

在运行 [`install-vps.sh`](install-vps.sh) 之前，请先完成以下步骤。

## 1. 购买云服务器

推荐：**阿里云轻量 / 腾讯云 Lighthouse / 华为云 Flexus**

| 项目 | 建议 |
|------|------|
| 系统 | Ubuntu 22.04 LTS |
| 规格 | 1 核 1GB 内存起 |
| 地域 | 靠近目标用户（如华东） |
| 带宽 | 3Mbps 起 |

## 2. 安全组 / 防火墙

| 端口 | 用途 | 对公网 |
|------|------|--------|
| 22 | SSH 管理 | 是（建议限制来源 IP） |
| 80 | HTTP | 是 |
| 443 | HTTPS | 是 |
| 3456 | Node 应用 | **否**（仅本机，由 Nginx 反代） |

## 3. SSH 登录

```bash
ssh root@你的公网IP
```

## 4. 一键部署

```bash
git clone https://github.com/bergmanvinicius158-png/agent-quote-platform.git
cd agent-quote-platform
sudo DOMAIN=你的公网IP或域名 ADMIN_PASSWORD=你的强密码 bash deploy/install-vps.sh
```

或先 `export DOMAIN=quote.example.com` 再运行脚本。

## 5. 域名与备案（可选）

- 国内域名指向大陆服务器通常需要 **ICP 备案**
- 备案完成后：`sudo certbot --nginx -d quote.example.com`

## 6. 后续更新

```bash
cd /opt/agent-quote-platform
sudo git pull origin main
sudo systemctl restart agent-quote
```
