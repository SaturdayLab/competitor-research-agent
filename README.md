# Competitor Research Agent

面向数字产品的智能竞品调研系统。用户可以手动选择 2–6 个竞品，也可以按产品类别、数量和国内/海外/全球范围自动发现候选产品，确认后再创建调研任务。独立 Worker 领取任务；配置 Brave 后动态规划、搜索、读页、抽取 Evidence、执行缺口补全与独立横向分析、生成报告并运行有界 Reviewer。

> 默认 `SEARCH_PROVIDER=disabled` 时不规划、不搜索、不读页、不分析，报告不能当作有来源的产品结论。`SEARCH_PROVIDER=brave` 且配置了服务端 `BRAVE_SEARCH_API_KEY` 后，才满足真实规划、搜索、读页与分析验收。没有 Key 时不要用 mock 搜索冒充远程调研。本项目定位为本地或受控环境中的 Demo，只提供单一管理员密码保护付费操作，不包含完整用户账号体系。

## 当前能力

- Next.js App Router 页面：新建调研、执行状态、报告、历史档案。
- 支持手动选择 2–6 个竞品，或在正式调研前自动发现并编辑候选产品。
- 自动发现按国内、海外或全球范围筛选，并以有用户规模、市场采用度或权威排名依据的主流、同赛道产品为先；全球结果至少包含一个国内和一个海外产品。
- 单次自动发现最多 2 次 Brave 搜索和 1 次 DeepSeek 筛选，确认后才产生正式调研费用。
- 候选产品可以逐个锁定；“换一批”只替换未锁定项。相同选品条件在 15 分钟内复用缓存，避免重复搜索费用。
- 报告提供章节目录与竞品锚点；资料索引和证据摘录默认各显示前 3 条，可按需展开完整列表。
- 游客可以查看历史任务和已有报告；自动发现、创建调研和重新执行需要管理员密码，会话使用 HttpOnly 签名 Cookie。
- PostgreSQL 持久化任务队列，使用 `FOR UPDATE SKIP LOCKED` 原子领取。
- Web 与长任务 Worker 分离。
- Zod 校验用户输入、模型输出和竞品覆盖。
- 确定性的 Demo Provider，以及可选 OpenAI Responses API Structured Outputs Provider。
- 工作流成功、失败和重新入队状态。
- V2 可为每个竞品执行一次 Brave Web Search，规范化 URL 后批量保存 Sources，并在报告页展示资料索引。
- V3 在搜索开启时读取每竞品前 2 个页面（SSRF 防护），抽取 Evidence，并在报告页展示证据摘录。
- V4 在搜索前动态生成 3–8 个共享分析维度和每竞品一条搜索词，并把维度传给 Extractor、Generator 和 Reviewer。
- V5 在 Evidence 与 Writer 之间增加独立 Analyst，按 Planner 维度覆盖全部竞品、保留 E 编号并显式记录 gaps。
- DeepSeek Analyst 使用逐格 Evidence ID 白名单；校验失败时携带错误原因纠错重试一次。只漏竞品时应用会补“资料不足”并登记 gap，错误或跨格 Evidence 引用仍会拒绝。
- V7 在首轮抽取后确定性选择最多三个 Evidence 空格，每格固定一搜；页面按搜索排名读取，首个失败时最多尝试第二个，模型不控制 URL、读页和停止。
- DeepSeek Reviewer 不通过时最多自动修订一次；模型返回的超额报告数组和审核意见会在既有 Schema 上限内规范化。
- Source、Evidence 和 Usage 表已在 migration 中建立；V3 写入页面纯文本和原子证据，不保存原始 HTML。

## 架构

```text
Browser
   │
   ▼
Next.js pages + Route Handlers
   │ create/read/enqueue
   ▼
Supabase / PostgreSQL ◀──── Research Worker
   │                          │
   │                          ├── SearchProvider (disabled | brave)
   │                          ├── PageReader (SSRF HTTP reader)
   │                          ├── EvidenceExtractor (demo | openai)
   │                          ├── Demo Provider
   │                          └── OpenAI Provider (optional)
   ▼
Task / Run / Step / Source / Evidence / Report
```

Route Handler 只做输入校验与短数据库操作。完整生成流程由 `npm run worker` 启动的独立进程负责，不依赖 HTTP 请求在响应后继续存活。

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Supabase

复制 `.env.example` 为 `.env.local`，填写：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEARCH_PROVIDER=demo
ADMIN_PASSWORD=至少十二位的管理员密码
ADMIN_SESSION_SECRET=至少三十二位的随机签名密钥
```

依次应用 `supabase/migrations` 中的 migration，包括 `202608290006_two_competitor_minimum.sql`；它把单次竞品数量从 3–6 调整为 2–6。Service Role Key、管理员密码和签名密钥只能用于服务端，不能暴露到浏览器或提交到仓库。管理员会话默认有效 8 小时；未配置或长度不足时，所有付费操作会默认拒绝。

### 3. 启动 Web 和 Worker

本地 Demo 推荐使用一个命令同时启动：

```bash
npm run demo
```

访问 `http://localhost:3000`。按 `Ctrl+C` 会同时关闭网页和 Worker，避免只启动网页后任务一直停在队列。

需要分别观察两个进程时，也可以打开两个终端：

```bash
npm run dev
```

```bash
npm run worker
```

Worker 会自动读取项目根目录的 `.env.local`，不必先手动注入环境变量。已在进程里设置过的变量不会被覆盖。可以使用首页的 AI Coding 或协同办公示例快速创建任务。

## 使用 OpenAI Provider

在 `.env.local` 中配置：

```dotenv
RESEARCH_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

实现位于 `src/lib/ai/openai-generator.ts`，使用 Responses API 的 `responses.parse` 与 `zodTextFormat`。模型名通过环境变量控制，避免在代码中绑定“最新模型”。参考 [OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs)。

## 使用 DeepSeek Provider

在 `.env.local` 中配置：

```dotenv
RESEARCH_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

DeepSeek 使用 Chat Completions 的 `response_format=json_object`，再用 Zod 校验。不要把 DeepSeek Key 填进 `BRAVE_SEARCH_API_KEY`。Generator、Extractor、Planner、Analyst、缺口查询规划器与 Reviewer 共用 `RESEARCH_PROVIDER`。改完后需要重启 Worker。

`RESEARCH_PROVIDER=deepseek` 且搜索开启时，首轮抽取后会针对最多三个 Evidence 空格定向补搜。每格固定一次搜索、读取首个合法未重复页面并补抽；模型只生成搜索词。旧的抽取前 Investigator 已停止调用，但实现暂时保留。生成报告后会再跑一轮 Reviewer，不通过则最多按 `REVIEW_MAX_REVISIONS`（默认 1）修改一次。

## 使用 Brave 搜索（V2）

在 `.env.local` 中配置：

```dotenv
SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=...
SEARCH_RESULT_COUNT=5
BRAVE_SEARCH_TIMEOUT_MS=8000
```

- `SEARCH_PROVIDER` 只接受 `disabled` 或 `brave`。缺省为 `disabled`，Worker 保持 V1 单步骤 `generating`。
- `BRAVE_SEARCH_API_KEY` 是服务端密钥，不能使用 `NEXT_PUBLIC_` 前缀。
- 每个竞品固定搜索一次，总计不超过 6 次；每次结果数默认 5，上限 20；请求超时默认 8 秒。
- 没有真实 Key 时只跑离线测试。Mock 搜索结果不能当作 V2 真实搜索验收。
- V2 只保存标题、URL 和摘要。开启搜索后，V3 会读取每竞品前 2 页并抽取 Evidence。
- `PAGE_READ_TIMEOUT_MS` 默认 8 秒，`PAGE_READ_MAX_BYTES` 默认 1MB，最多 3 次跳转；密钥类变量不能使用 `NEXT_PUBLIC_`。
- Extractor 与 Generator 共用 `RESEARCH_PROVIDER`。

## 自动发现竞品

在首页选择“自动发现”，填写产品类别、数量（2–6）和地域范围：

- 国内：只保留由中国大陆公司或组织开发的候选。
- 海外：只保留由中国大陆以外公司或组织开发的候选。
- 全球：至少包含一个国内和一个海外候选。

系统先用带有主流度信号的查询调用 Brave，再由 DeepSeek 在编号搜索结果内筛选同一主要细分赛道、竞争层级相近的产品并提供简短理由。产品官网自述只能证明产品存在，不能单独证明代表性；确认后才创建正式调研任务。需要指定产品时切换到手动模式。自动发现结果只用于选品，不作为报告 Evidence；若没有至少两个有搜索依据的候选，系统不会用小众或弱相关产品凑数。

发现候选后可以锁定满意的产品，再点击“换一批未锁定产品”。服务端排除已经展示过的候选，只补充空位；重复的类别、地域、数量和排除条件会命中 15 分钟进程内缓存。对于“办公”“AI”“电商”等宽泛类别，界面会提示更具体的输入示例，但不阻止继续发现。

## 项目结构

```text
src/
├── app/                 # 页面与 Route Handlers
├── components/          # 客户端交互和报告视图
├── lib/
│   ├── ai/              # Provider 接口与实现
│   ├── domain/          # Zod Schema 和领域类型
│   ├── http/            # API 错误与客户端辅助函数
│   ├── research/        # Repository、Workflow、Markdown
│   ├── search/          # SearchProvider、Brave Adapter、URL 规范化
│   ├── read/            # PageReader、SSRF 校验、HTML 抽文本
│   └── supabase/        # 服务端客户端与持久化实现
└── worker/              # 独立 Worker 入口

supabase/migrations/     # 可复现数据库结构
tests/                   # Vitest 单元与静态 migration 测试
```

## API

- `POST /api/research`：创建任务并入队。
- `GET /api/research?limit=30`：读取历史任务。
- `GET /api/research/[id]`：读取任务、步骤、来源数量和报告状态。
- `POST /api/research/[id]/run`：失败或已完成任务重新入队。
- `GET /api/report/[id]`：读取最新报告及其同一 Run 的 Sources 与 Evidence。

## 验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

单元测试不需要外部密钥。Supabase migration 和远程 OpenAI 调用需要相应项目与凭据，不能由本地单元测试代替。

## 离线评测（V6）

Evaluation 读取一次已经完成的真实 Run，按确定性规则计算竞品、来源、证据、维度、引用、页面读取和缺口补全效果，不会重新调用 Brave 或模型：

```powershell
& 'D:\node\node_global\npm.cmd' run eval -- --run-id <workflow_runs.public_id>
```

这里必须传 `workflow_runs.public_id`，不是 Task ID。结果保存在 `eval/results/<时间>-<run-id>/result.json` 和 `summary.md`，该目录默认不入库。低覆盖率和 Reviewer 未通过属于体检结果，退出码仍为 `0`；输入无效为 `2`，指标计算异常为 `1`。

首版不会计算幻觉率、关键事实有来源比例或 Reviewer 问题发现率；后两项会明确标记为 `not_available`，避免把缺少人工标注或事实级引用的数据包装成客观分数。

## 当前限制

- 项目定位为本地或受控环境 Demo；管理员密码只保护付费操作，不提供用户注册、个人数据隔离或多角色权限体系。
- OpenAI 路径不再继续扩展；当前主验收路径是 DeepSeek + Brave。
- V4 Planner 动态生成搜索词，但每个竞品仍最多搜索一次。
- V3 每竞品最多读 2 页；单页失败跳过，零成功或证据为空则任务失败。
- V7 缺口补全最多选择 3 个空格，每格搜索一次、最多读取两个候选页面；Analyst 不调用搜索或读页工具。
- 云端 Supabase 已执行 `202608270001` 至 `202608280005`。
- 没有 Brave API Key 时，离线测试不能代替真实远程搜索与读页验收。
- Demo Provider 报告是工程占位输出，不能用于产品决策。

V7 已用真实 DeepSeek + Brave 任务完成验收，V6 已提供单 Run 离线评测基线。后续如继续优化，应先用少量不同类型的真实任务比较 Evidence 缺口补全前后的质量与成本；搜索缓存仅在重复查询明显造成额外 Brave 请求时再实现。
