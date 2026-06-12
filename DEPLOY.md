# 部署指南（Railway / Render）

本项目是 **Node.js 全栈应用**，需运行 `node server.js`，不能作为纯静态站点部署。

---

## 部署前检查

- [ ] 已准备 GitHub 账号
- [ ] 已设置强密码 `ADMIN_PASSWORD`（生产环境勿用 `admin123`）
- [ ] 定价模板文件在 `data/pricing.json`、`data/addons.json`、`data/costs.json` 中已配置好

---

## 方式 A：Render（推荐，配置已内置）

项目根目录已包含 [`render.yaml`](render.yaml)，支持 Blueprint 一键部署。

### 步骤

1. **推送代码到 GitHub**
   ```bash
   cd agent-quote-platform
   git init
   git add .
   git commit -m "Prepare for Render deployment"
   git branch -M main
   git remote add origin https://github.com/你的用户名/agent-quote-platform.git
   git push -u origin main
   ```

2. **登录 [Render Dashboard](https://dashboard.render.com)**

3. **New → Blueprint**，连接 GitHub 仓库

4. Render 会自动读取 `render.yaml`，创建 Web Service

5. **设置环境变量**
   - `ADMIN_PASSWORD` = 你的强密码（必填）

6. **部署完成后** 获得公网地址，例如：
   - 报价页：`https://agent-quote-platform.onrender.com/`
   - 管理后台：`https://agent-quote-platform.onrender.com/admin/login.html`

### 数据持久化（Render）

- `render.yaml` 已配置磁盘挂载到 `data/`（1GB）
- **免费版**可能不支持持久磁盘，重启后报价单可能丢失
- 正式使用建议升级到 **Starter** 计划并确认 Disk 已启用

---

## 方式 B：Railway

项目根目录已包含 [`railway.toml`](railway.toml)。

### 步骤

1. 代码推送到 GitHub（同上）

2. 登录 [Railway](https://railway.app) → **New Project → Deploy from GitHub repo**

3. 选择仓库，Railway 自动检测 Node.js 并执行 `node server.js`

4. **Variables** 中添加：
   - `ADMIN_PASSWORD` = 你的强密码

5. **Settings → Networking → Generate Domain** 生成公网域名

6. **持久化 data/（重要）**
   - Settings → **Volumes**
   - Mount Path: `/app/data`
   - 重新 Deploy

---

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 平台自动注入，默认 3456 |
| `ADMIN_PASSWORD` | **是** | 管理后台登录密码 |

---

## 健康检查

平台会请求 `GET /api/pricing` 判断服务是否存活。

---

## 本地验证生产模式

```bash
set ADMIN_PASSWORD=你的密码
set PORT=3456
node server.js
```

---

## 常见问题

**Q: 部署后管理后台登录失败？**  
A: 确认已设置 `ADMIN_PASSWORD` 环境变量并重新部署。

**Q: 报价单提交后丢失？**  
A: 未挂载持久化磁盘。Render 启用 Disk，或 Railway 添加 Volume 到 `/app/data`。

**Q: 免费版休眠？**  
A: Render 免费版长时间无访问会休眠，首次打开需等待 30–60 秒唤醒。

**Q: 如何更新定价规则？**  
A: 登录管理后台修改，或直接编辑 `data/*.json` 后重新部署（有 Volume 时数据会保留）。
