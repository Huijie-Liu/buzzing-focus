# What's Buzzing

一个聚合多源新闻的网页应用，支持 AI 翻译与要闻总结。

## 本地运行

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python server.py
```

默认地址是 `http://127.0.0.1:8765`。

## 测试

```bash
. .venv/bin/activate
python -m unittest discover -s tests
```

## Vercel 部署

项目已提供 Vercel 可识别的 Flask WSGI 入口：`server.py` 中的 `app`。

在 Vercel 导入 GitHub 仓库后，Framework Preset 选择 `Other`，Build Command 留空。

需要在 Vercel Project Settings -> Environment Variables 中配置：

```text
DEEPSEEK_API_KEY=your_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

- **DeepSeek** 驱动 `/api/summary` 的 AI 要闻总结，以及 `/api/translate` 的标题/摘要翻译。
  未设置时，feed 保持原文，总结接口不可用。
- 可选：读取 `~/.claude/settings.local.json` 中的 `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN`（指向 DeepSeek 的兼容端点）作为备用配置。

`public/` 中的文件会作为静态资源发布，后端接口由 Flask app 提供：

- `GET  /api/feed` — 流式 NDJSON，逐源推送新闻卡片
- `GET  /api/preview?url=` — 抓取文章摘要预览
- `GET  /api/preview-image?url=` — 抓取文章 og:image
- `POST /api/translate` — 流式翻译可见卡片的标题/摘要
- `POST /api/summary` — 流式生成 AI 要闻简报
- `GET  /api/debug` — 本地默认开启，生产需 `ENABLE_DEBUG=1`
