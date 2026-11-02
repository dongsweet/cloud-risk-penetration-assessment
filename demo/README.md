# 云计算跨层风险穿透评估 Demo

这是一个用于预审可行性演示的云计算跨层风险穿透评估系统。系统以虚构的政务云资产和租户业务数据为样例，展示从证据采集到风险报告的可追溯闭环。后端使用 Egg.js 4.2、Node.js 22.18 或更高版本、SQLite，前端使用 AdminLTE 4。

## 已实现能力

- 多源证据上传：TXT、CSV、JSON、Markdown、DOCX、可提取文本的 PDF。
- OpenAI-compatible 模型抽取：模型只负责从材料中提出资产、关系、风险和追问候选；服务端检查返回结构，失败时保留待处理状态，不使用静默模拟结果。
- 跨层图谱：平台资产、租户业务资产和安全控制节点，支持承载、部署、支撑、权限、共享资源和隔离关系，保留来源、置信度和失效状态。
- 规则引擎：有效路径遍历、环路防止、穿透影响评分、租户侧风险值、风险等级和风险结果持久化。
- 人机协同：缺失槽位追问、人工风险等级/风险值修订、审计记录、整改任务状态和 PDF 报告。

默认样例包括 H01 宿主机、V1 虚拟化组件、VM-A1 租户虚拟机、DB-A 租户数据库、政务服务事项业务、U01 运维账号、R01 资源池和 SG01 隔离安全组。首次启动自动写入 SQLite，便于录屏直接展示；生产部署前应替换或清理样例数据。

## Linux 测试机部署

```bash
git clone git@github.com:dongsweet/cloud-risk-penetration-assessment.git
cd cloud-risk-penetration-assessment/demo
cp .env.example .env
vi .env
# 若测试机已有服务占用 7001，可改成 HOST_PORT=17001
docker compose up -d --build
curl http://127.0.0.1:7001/health
```

将 `.env` 中的 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL` 配置为实际 OpenAI-compatible 服务。密钥只在服务端使用，不写入 SQLite，也不返回前端。未配置模型时，系统仍可浏览样例图谱并执行规则计算，但上传证据的抽取会明确保持 `pending` 并提示配置错误。

访问 `http://服务器地址:17001/`（若按默认端口部署则为 `7001`），当前测试机为 `http://172.20.30.201:17001/`。建议录屏顺序：

1. 总览：展示项目范围、闭环进度、节点/路径/高风险/待补全统计。
2. 证据采集：上传一份 TXT 或 DOCX，点击“调用模型抽取”，展示资产候选、来源和置信度。
3. 图谱：展示平台侧风险源沿承载、部署和支撑关系穿透至租户业务。
4. 风险计算：重新执行计算，展开路径、评分和租户风险值。
5. 聚焦复核：回答待补全槽位，再对高风险项进行人工修订回写。
6. 整改与审计：改变任务状态，展示模型调用、计算和复核审计轨迹，最后导出 PDF。

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
