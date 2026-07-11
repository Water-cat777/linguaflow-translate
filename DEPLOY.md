# LinguaFlow 智能翻译工作台 - 部署指南

## 方式一：Render.com 部署（推荐，免费额度）

### 步骤：
1. 将项目推送到 GitHub 仓库
2. 登录 [Render.com](https://render.com)
3. 点击 "New" → "Web Service"
4. 连接你的 GitHub 仓库
5. 配置如下：
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Port**: 10000（或留空，Render 自动检测）
6. 点击 "Create Web Service"
7. 等待部署完成，Render 会自动分配一个域名（如 `linguaflow-xxx.onrender.com`）

### 可选：绑定自定义域名
1. 在 Render 服务设置中找到 "Custom Domains"
2. 添加你的域名
3. 按照提示配置 DNS 记录

## 方式二：Vercel 静态部署（无需后端）

项目已改造为支持纯前端运行（所有数据使用 localStorage）：

1. 安装 Vercel CLI: `npm i -g vercel`
2. 登录: `vercel login`
3. 在项目根目录运行: `vercel --prod`
4. 按提示操作即可

注意：静态部署模式下文件上传仅支持 .txt 格式。如需完整功能，推荐使用方式一。

## 方式三：Docker 部署

```bash
docker build -t linguaflow .
docker run -d -p 3000:10000 linguaflow
```

## 方式四：本地运行

```bash
npm install
node server.js
# 访问 http://localhost:3000
```

## 默认账号
- 用户名: `demo`
- 密码: `demo123`

## API 配置
1. 登录后点击右上角齿轮图标
2. 选择翻译服务提供商（DeepSeek 或 OpenAI）
3. 输入你的 API Key
4. 选择模型
5. 保存设置
