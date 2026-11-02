# 云计算跨层风险穿透评估 Demo

这是一个用于预审可行性演示的云计算跨层风险穿透评估系统。系统启动后不创建评估项目，也不内置资产、风险、TXT、DOCX 或其他证据材料；页面中的节点、关系、风险和追问全部来自用户上传材料及通过校验的真实 LLM 抽取结果。后端使用 Egg.js 4.2、Node.js 22.18 或更高版本、SQLite，前端使用 AdminLTE 4。

## 已实现能力

- 多源证据上传：Excel 图谱模板、TXT、CSV、JSON、Markdown、DOCX、可提取文本的 PDF。
- OpenAI-compatible 模型抽取：模型只负责从材料中提出资产、关系、风险和追问候选；服务端检查返回结构，失败时保留待处理状态，不使用静默模拟结果。
- 跨层图谱：平台资产、租户业务资产和安全控制节点，支持承载、部署、支撑、权限、共享资源和隔离关系，保留来源、置信度和失效状态。
- 规则引擎：有效路径遍历、环路防止、穿透影响评分、租户侧风险值、风险等级和风险结果持久化。
- 人机协同：缺失槽位追问、人工风险等级/风险值修订、审计记录、整改任务状态和 PDF 报告。

默认部署不创建评估项目，也不会展示资产或证据。进入系统后先在“项目管理”中填写项目名称和评估范围并创建项目；切换项目后，证据、图谱、风险、复核、整改和审计记录均按项目隔离。评估人员可下载空白 Excel 图谱模板并填写本次评估材料，也可以上传 TXT、CSV、JSON、Markdown、DOCX 或可提取文本的 PDF，由已配置的真实模型抽取候选结果。模型失败、超时或结构化结果校验失败时，材料保持 pending，不进入图谱或风险计算。

Excel 模板包含“资产节点”“关系边”“风险源”“填写说明”四个工作表。模板默认只有字段表头，没有虚构数据。关系边的起点和终点必须能在资产节点表或当前项目图谱中找到；导入失败时材料会保留为 `rejected`，不会产生部分节点或关系。



## 用户模型与首次初始化

系统使用本地 SQLite 账号模型，密码采用 Node.js `crypto.scrypt` 加随机盐保存，数据库只保存会话令牌摘要。页面权限和 API 权限同时校验，角色职责如下：

- **系统管理员**：维护系统名称、会话策略、模型服务地址/模型名和证据置信度阈值，并可维护风险计算参数。
- **安全管理员**：创建、编辑、停用账号、分配角色和操作员职责、重置密码。
- **操作员**：按账号分配的“评估”或“复核”职责执行证据上传、真实模型抽取、风险计算、追问、整改和复核回写。
- **审计管理员**：只读查看业务材料、报告和认证/操作审计记录，不能写入业务结果。

首次启动时，如果数据库中还没有账号，登录页提供“初始化系统”入口创建第一个系统管理员；也可以在 `.env` 设置 `BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_DISPLAY_NAME` 和 `BOOTSTRAP_ADMIN_PASSWORD` 自动创建。初始账号首次登录必须修改密码。密码至少 12 个字符。生产环境请同时设置随机的 `APP_KEYS`，不要把密码或模型 API key 写入版本库、镜像或 README。

## Linux 测试机部署

```bash
git clone git@github.com:dongsweet/cloud-risk-penetration-assessment.git
cd cloud-risk-penetration-assessment/demo
cp .env.example .env
vi .env
docker compose up -d --build
curl http://127.0.0.1:17003/health
```

将 `.env` 中的 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL` 配置为实际 OpenAI-compatible 服务。密钥只在服务端使用，不写入 SQLite，也不返回前端。未配置模型时，Excel 图谱仍可导入，文档材料的抽取会明确保持 `pending` 并提示配置错误。

访问 `http://服务器地址:17003/`，当前测试机为 `http://172.20.30.201:17003/`。容器内部端口固定为 `7001`，Compose 默认将宿主机 `17003` 映射到该端口。建议录屏顺序：

1. 总览：展示当前项目状态；空项目会显示“等待导入资产图谱”。
2. 证据采集：下载空白 Excel 模板，填写真实资产、关系、风险源并导入，展示导入记录和校验状态。
3. 证据采集：上传本次评估的 Excel 或文档材料，展示原始文件状态、模型抽取候选、来源与置信度；未配置模型时只展示待处理状态。
4. 图谱：展示导入资产的实际来源、置信度以及平台到租户的关系。
5. 风险计算：重新执行计算，展开路径、评分和租户风险值。
6. 聚焦复核：回答待补全槽位，再对高风险项进行人工修订回写。
7. 整改与审计：改变任务状态，展示模型调用、计算和复核审计轨迹，最后导出 PDF。

## 规则说明

系统保存的规则配置使用以下公式：

```text
S  = w1C + w2N + w3P + w4R + w5E + w6B - w7I
Tp = S + w7
Pt = min(1, Pp * (1 + α * Tp))
Lt = λ1Av + λ2K + λ3D + λ4Ic
Rt = Pt * Lt
```

因子统一归一化到 `[0,1]`；演示默认穿透因子权重相等、`α=0.5`、损失因子权重相等，等级阈值为 `0.2/0.4/0.6/0.8`。这些是可调整的演示参数，计算时会保存在结果配置中。

## API 入口

- `GET /health`
- `GET /api/v1/templates/graph.xlsx`（空白模板）
- `GET /api/v1/projects` / `POST /api/v1/projects`（项目列表与新建项目）
- `GET /api/v1/dashboard`
- `GET /api/v1/projects/:id`
- `POST /api/v1/evidence/:projectId/upload`
- `POST /api/v1/evidence/:projectId/:evidenceId/extract`
- `GET /api/v1/graph/:projectId`
- `POST /api/v1/risks/:projectId/calculate`
- `POST /api/v1/reviews/:reviewId`
- `POST /api/v1/followups/:followupId/answer`
- `PUT /api/v1/risks/:projectId/config`
- `GET /api/v1/report/:projectId.pdf`

## 数据与持久化

SQLite 文件位于 `DATA_DIR/risk-demo.db`，上传文件位于 `UPLOAD_DIR`。Compose 将两处目录挂载到宿主机，因此容器重建不会丢失证据和结果。当前服务是单实例演示版，正式环境还应增加反向代理、认证、备份和访问控制。
