# 工作英语复习

每天一份 Markdown 练习记录，构建成一个方便日常复习的静态网站：按日期浏览、关键词搜索，并清楚展示中文原意、最终英文、会议问答和重点纠正。页面适配手机和电脑。

新增一天的练习后，重新构建（并在需要时重新发布）即可更新网站，不必改前端代码。

## 当前进度

- `notes/` 中已有 2026-11-23、2026-11-24、2026-11-25 三天的练习记录。
- 已实现静态复习网站（构建脚本 + `site/` 前端），本地构建通过。
- 网站部署到独立的 nginx 站点，不占用、不覆盖服务器上已有的网站或端口。访问地址由部署时确认，**不要把服务器地址、登录方式或域名写入本仓库**。

## 项目结构

```
.
├── AGENTS.md                 # 给后续 Agent 的项目约定
├── README.md
├── notes/                    # 每天一份练习 Markdown（源内容）
│   ├── README.md             # 练习目录索引
│   └── YYYY-MM-DD_主题.md
├── scripts/
│   ├── build.py              # 把 notes/*.md 构建成 site/data/notes.json
│   └── deploy.sh             # 构建并同步到服务器目录（主机用环境变量传入）
├── site/                     # 静态网站（构建产物，可直接用 HTTP 服务）
│   ├── index.html
│   ├── assets/
│   └── data/notes.json
└── deploy/
    └── nginx-site.example.conf   # nginx 配置示例（占位符，不含真实主机信息）
```

## 本地构建与预览

需要 Python 3.9+（仅用标准库，无需安装依赖）。

```bash
python3 scripts/build.py
python3 -m http.server 4173 --directory site
```

浏览器打开 `http://127.0.0.1:4173/`。构建脚本会扫描 `notes/` 下以 `YYYY-MM-DD_` 开头的 Markdown，忽略 `notes/README.md`，并写入 `site/data/notes.json`。

## 如何新增一天的练习

1. 在 `notes/` 新增文件，文件名格式：`YYYY-MM-DD_简短主题.md`。
2. 在 `notes/README.md` 里补一行链接。
3. 建议使用这些栏目（标题不必完全一致，构建脚本会识别常见别名）：
   - `中文原意`
   - `最终英文`（或「整理后的英文汇报」）
   - `同事追问与推荐回答` / `站会追问练习`
   - `重点纠正` / `重点修正` / `重点表达` / `重点词汇`
   - 可选：`待确认的专有名称`、`下次复习`、文末 `备注：`
4. 运行 `python3 scripts/build.py`。
5. 若网站已部署，再执行一次发布（见下）。

问答建议写成：

```markdown
**Q: English question?**

中文：中文问题

**A:** English answer.

中文：中文回答
```

纠正和词汇用 Markdown 表格即可。

## 部署方法

不要把服务器 IP、账号、密码或域名提交到仓库。用环境变量传入主机信息。

1. 开始前先检查目标机器已有的服务和端口（`ss -lntup`、nginx `sites-enabled`、Docker 端口等），不要覆盖已有网站，也不要占用已在使用的端口。
2. 把 `site/` 发布到一个**新建**目录，例如 `/var/www/work-english-notes`。可用：

   ```bash
   DEPLOY_HOST=your-server DEPLOY_USER=ubuntu ./scripts/deploy.sh
   ```

   默认远程目录是 `/var/www/work-english-notes`，可用 `DEPLOY_PATH` 覆盖。
3. 参考 `deploy/nginx-site.example.conf` 增加一个**新的** nginx 站点：优先监听一个未占用端口；如需走 80 端口，只用独立的 `location` 或独立 `server_name`，不要改现有默认站或已有 HTTPS 站点。
4. `sudo nginx -t` 通过后再 reload。用本机和外部 `curl` 确认页面可打开，且能看到当天笔记中的原文。

若以后有域名，再为该站点单独配置 `server_name` 与 TLS，仍然不要改动其他站点。

## 网站功能

- 按日期浏览，默认打开最新一天。
- 搜索中文原意、最终英文、问答和纠正表；可用 `/` 聚焦搜索框。
- 「全部显示 / 先看中文 / 先看英文」便于对照或自测。
- 桌面端中英对照，手机端单列排布。
