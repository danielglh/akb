# Agent Knowledge Base — 技术设计方案

**Version:** 1.3 Draft\
**Date:** 2026-10-30\
**Status:** MVP 0.1.0 complete; validated on macOS and Linux arm64 (see docs/mvp-validation.md)  
**Working Name:** `akb` (Agent Knowledge Base)

---

## 1. Executive Summary

构建一套轻量级、Local-first、Git-native、Agent-first 的知识库工具链。

**首个交付（本文统一称 MVP）的目标：给 Agent 一份新资料，它能合理地更新知识库，下次提问时能找到并准确引用。**

采用：**Git + Markdown + OKF v0.2 + 可替换检索（QMD / rg）+ 最小 CLI + 两个 Agent Skills**。

- Git 保存版本、Diff 和人工确认后的提交。
- Markdown + OKF 从第一篇知识开始作为持久化格式。
- AKB 定义检索行为；QMD 是主要实现，rg 是可独立使用的基础实现和降级实现。
- CLI 负责确定性的读取、校验、安全写入和检索适配。
- `akb-ingest`、`akb-search` 使用 Agent 已有的 LLM 能力，不另设 LLM 服务。

知识文件是唯一的持久化事实来源。搜索索引可重新生成，替换检索实现不要求修改知识文件或 Skill。

### 1.1 MVP Scope

当前支持多个命名 KB；每个 KB 是一个本地 Git Repository 中的一个 OKF Bundle。每条内容命令必须显式提供已注册的 `--kb NAME`，不设默认库；目录分类由用户决定。

必须交付：

- 初始化、按名称注册和列出多个 KB；每次显式选择一个已注册 KB。
- Concept 读取、创建、更新，保留来源及既有有效结论。
- QMD 关键词检索、rg 关键词检索及明确的降级行为。
- YAML / OKF 基础校验、链接检查、安全写入、Git Diff。
- 两个 Skill，覆盖 Create / Update / No-op / Review。
- 固定案例验证知识整理和后续检索，而非仅验证命令能运行。

### 1.2 Design Principles

1. **Data ownership first**：移除 AKB 和检索工具后，知识仍可阅读和修改。
2. **Simplicity over features**：复用 Git、QMD、rg 和成熟解析库，不开发通用插件框架。
3. **Standard over proprietary schema**：遵循 OKF v0.2，保留未知类型和字段；AKB 扩展使用 `akb` 命名空间。
4. **Agent-native, human-controllable**：语义判断由 Agent 完成，写入可检查，提交由用户授权。
5. **Progressive disclosure**：先检索，再读取候选页面，禁止将整个 KB 填入上下文。
6. **Graceful degradation**：QMD 不可用时可使用 rg；无 LLM 时 CLI 仍可用。
7. **Security by isolation**：文件权限和执行环境是访问边界，检索过滤不是权限系统。
8. **Minimal operations**：无常驻服务、必需云服务或独立数据库。

### 1.3 Deferred Scope

以下均不属于 MVP 验收条件：

- 跨 KB 聚合检索、个人与团队协作、Review 分支策略、多 Agent Worktree 工作流。
- Semantic / Hybrid Search、Embedding 管理与模型调优。
- 自动导航生成或重写、自动维护、批量去重、页面合并及移动。
- `kb-maintain`、独立 `kb-review` Skill、MCP Server。
- URL / PDF / 外部系统摄取、定期抓取、自动会话摄取。
- Web UI、SaaS、登录 / RBAC、实时协作、知识图谱数据库。
- 与 Project Memory 系统合并。

团队知识库是后续场景。MVP 不宣称已经提供多用户权限或团队发布隔离。

---

## 2. System Architecture

### 2.1 Logical Architecture

```text
Human / Coding Agent
        |
akb-ingest / akb-search
        |
      akb CLI
        |
        +-- Knowledge Ops / Validation --> Git + Markdown + OKF
        |
        +-- Retrieval contract
                  +-- QMD adapter --> rebuildable local search index
                  +-- rg adapter  --> current Markdown files
```

### 2.2 Responsibilities

| Component | Responsibility |
|---|---|
| Git | 历史、Diff、人工授权后的提交；提交不等于知识已验证 |
| Markdown + OKF | 知识正文、元数据、来源、生命周期和普通 Markdown 链接 |
| AKB core | Bundle 边界、解析、校验、原始内容 Hash、安全写入 |
| AKB retrieval | 检索范围、能力检查、统一结果、实际后端和模式、降级信息 |
| QMD adapter | 调用 QMD CLI、管理所选 KB 的独立索引、归一化结果 |
| rg adapter | 对所选 KB 当前文件进行确定性的关键词检索 |
| Agent Skills | 提炼知识、判断重复和冲突、提出修改、读取并引用页面 |

Skill 通过 `akb` 读写知识和执行检索。不得绕过 CLI 安全写入流程；用户仍可用普通编辑器修改文件，但 CLI 无法强制约束外部写入。

### 2.3 Dependency Direction

```text
Agent Skills -> AKB CLI -> Core / Retrieval contract
Core -> Markdown / OKF / Git / filesystem
Retrieval contract -> QMD adapter or rg adapter
```

核心存储不得依赖 QMD 的 SQLite Schema、Doc ID、Chunk 或内部模块。只实现两个明确的适配器及其共同接口，不实现动态插件加载、第三方注册中心或通用检索 DSL。

---

## 3. Knowledge Base Organization

### 3.1 One Repository, One Bundle

每个注册的本地 Git Repository 根目录也是 OKF Bundle 根目录。AKB 定义固定内容目录：

```text
~/knowledge/personal-kb/
├── index.md
├── knowledge/
│   ├── knowledge/engineering/postgresql-vacuum.md
│   └── research/agent-memory.md
├── source/
│   └── policy-v1.md
├── README.md
├── INSTALL.md
└── AGENTS.md
```

`knowledge/` 保存整理后的知识页，`source/` 保存可引用的 OKF 来源页与原始附件。两者内部可自由分类；不支持仓库内多个 Bundle。`init` 创建这两个目录、各自的导航索引和根索引，保证空内容目录也可进入 Git，不覆盖已有文件。Concept ID 是包含上述目录前缀的 Bundle-relative 路径（不含 `.md`）。

lint 的内容范围只限这两个目录中的 Markdown，外加根 `index.md` / `log.md` 的专用导航校验；搜索只处理两个目录中的非保留 Concept。README、INSTALL、AGENTS 等仓库说明放在知识区之外，保持普通 Markdown，不要求 Frontmatter，也不检查其示例链接。其他目录同样不进入知识扫描。知识页里的链接和来源仍检查真实目标的路径边界、Symlink 与存在性；知识区内缺少 Frontmatter 或损坏 YAML 仍报错。

CLI Concept 读写只允许 `knowledge/` 或 `source/` 下的非保留页面，防止写出检索不到的知识或覆盖说明文件。两目录都缺失的旧布局在扫描时明确报 `INVALID_BUNDLE`。迁移需要用户明确移动真实知识页并更新链接、来源路径和 ID，AKB 不自动搬动任何文件；留在范围外的文件不参与扫描。非 Markdown 原始附件可以放在 `source/`，该目录的 Markdown 来源页仍按 OKF 校验。

### 3.2 Configuration

用户级配置遵循 XDG；默认路径为 `~/.config/akb/config.yaml`。

```yaml
version: 2
knowledge_bases:
  - name: personal
    path: ~/knowledge/personal-kb
  - name: work
    path: ~/knowledge/work-kb
retrieval:
  provider: qmd
  fallback: ripgrep
```

- `path` 在注册时展开并规范化，必须指向 Git Repository 根目录。
- `provider` 只能为 `qmd` 或 `ripgrep`；`fallback` 只能为 `ripgrep` 或 `none`。
- QMD 的 Collection、命名索引及缓存位置由适配器管理，不进入通用 KB 数据模型。
- 不把本机绝对路径写入知识文件或提交到 KB。
- 允许同时注册多个 KB；同名重复注册报错，不覆盖现有登记。`list` 返回名称和路径。
- 配置不保存默认或当前 KB。所有库级命令都必须显式提供 `--kb NAME`，即使只注册了一个库。
- v1 单库配置只读时转换为内存中的 v2；下一次注册/注销在配置锁下原子写入 v2，保留旧登记和检索设置。旧 CLI 不支持 v2，不能混用。
- 检索后端配置为所有 KB 共用；每个 KB 的索引与文件锁仍按规范化根路径隔离。
- `remove` 只注销配置，不删除目录、Git 历史或知识文件。

### 3.3 Scope and Discovery

`akb list` 返回所有注册 KB 的名称和路径；`akb info --kb NAME` 返回指定 KB 的名称、路径、Git 状态、实际检索配置和依赖状态。

所有内容操作都限定在显式选择的 Bundle。缺少 `--kb NAME` 返回 `KB_REQUIRED`；名称未注册返回 `UNKNOWN_KB`，两者均退出 2，不读取或修改其他 KB。禁止按当前目录、唯一登记或上次操作隐式选库，不提供跨 KB 聚合查询或自动发现磁盘上其他知识库的能力。

---

## 4. Knowledge Data Model

### 4.1 OKF Compliance

目标版本：**OKF v0.2**。

以官方规范定义基础格式，不创建一套替代 OKF 的自有 Schema。

概念页面使用：

```markdown
---
type: Reference
title: PostgreSQL VACUUM and Replication Lag
description: Causes and mitigation of replica lag during VACUUM.
tags:
  - postgresql
  - replication
  - operations
status: stable
---

# PostgreSQL VACUUM and Replication Lag

## Overview

...

## Causes

...

## Mitigation

...

## Related Knowledge

- [PostgreSQL Operations](postgresql-operations.md)
```

这里的 `Reference` 只是示例类型，必须兼容未知 `type`。MVP 从第一篇 Concept 开始采用 OKF，不将格式兼容推迟到后续版本。

### 4.2 Metadata Requirements

分为三层。

**Layer 1 — OKF Required**

- `type`

这是 Concept Frontmatter 格式兼容性所要求的最小字段，值必须为非空字符串。每个非保留 `.md` 都需要可解析的 YAML Frontmatter；`index.md`、`log.md` 遵循各自保留文件约定。

**Layer 2 — AKB Recommended**

- `title`
- `description`
- `tags`
- `status`
- `sources`

对于由 Agent 创建的已整理知识，强烈建议具备 title、description、来源信息。

但是缺少推荐字段不能被视为 OKF 格式不合规。

**Layer 3 — Optional OKF / AKB Extensions**

- `generated`
- `verified`
- `stale_after`
- `resource`
- `akb`

`akb` 用作项目私有扩展命名空间，而不是覆盖 OKF 字段。

示例：

```yaml
akb:
  aliases:
    - postgres vacuum replication lag
```

以上扩展仅说明命名空间，MVP 不要求实现 alias 检索。MVP 不引入数据库式全局 UUID。

概念 ID 采用 OKF 规定的 Bundle-relative 文件路径（不含 `.md`）。文件移动时，应同步更新内部链接。CLI 可以在后续版本中提供安全的 rename/move 功能。

### 4.3 Lifecycle

遵循 OKF 的生命周期：

- `draft`：尚未完成整理或验证；Agent 新建且未确认的内容显式使用此值。
- `stable`：可作为当前知识使用。
- `deprecated`：已不再推荐使用，保留历史和链接。

缺失 `status` 时按 OKF 默认为 `stable`，但不据此推断已验证。使用 `stale_after` 表示知识需要重新验证的绝对时间，要求包含明确时区；`now >= stale_after` 即为过期。

注意：

**Stale 不等于 Incorrect。**

例如某个 API 文档到达复查时间，只代表需要确认当前有效性，不能直接将它删除或标记为错误。

同理，`stable` 不等于 human-reviewed，`verified` 也不能用作文件访问控制。`verified` 同时兼容单个 `{by, at}` 对象和对象列表，读取时统一处理。

AKB 摄取策略：正文实质变化时更新 `generated`，不沿用旧的 `verified` 作为新正文背书；移除当前验证标记并在提案中说明，旧记录仍保留在 Git 历史。仅格式或链接修正可保留验证记录，但必须检查未改变事实。不得伪造 `human:` 身份。

### 4.4 Provenance

Agent 从外部资料或已有文档提炼知识时，应尽可能保留可追溯来源。

使用 OKF 标准 `sources` 字段和正文 footnotes。

例如：

```yaml
sources:
  - id: postgres-docs
    resource: https://www.postgresql.org/docs/18/routine-vacuuming.html
    title: PostgreSQL 18 — Routine Vacuuming
```

对于个人经验或原始观察，可以记录内部文件路径或其他可审查的来源，而不是编造网页引用。

规则：

1. Agent 不得伪造来源。
2. 来源不明的事实性内容不得自动宣称已验证。
3. 支持多个来源。
4. 对重要结论，优先在正文建立来源与结论之间的对应关系。
5. 无法确认真实性时，应标注不确定性或保留为 Draft。
6. 新证据与现有知识矛盾时，不得静默覆盖。
7. `sources[].resource` 保留具体版本或可追溯位置；重要结论的 footnote label 与 `sources[].id` 对应，不能仅引用宽泛主页掩盖出处。

### 4.5 Page Granularity

一个知识页面应围绕一个相对独立的主题或概念。

不应：

- 将一个项目的全部知识放进单个超大文件。
- 把每句话都拆成单独概念。
- 每次 Agent Session 都产生一篇新知识页面。
- 为重复主题创建大量近义文件。

建议的拆分条件：

- 页面包含多个可以独立使用的主题。
- 不同子主题具有不同的更新频率。
- 某个部分可以成为多个页面的共同引用对象。
- 页面增长到难以快速定位相关信息。

不设置绝对字数上限。文件长度只能用于提示，不应自动触发拆分。

### 4.6 Index Files

使用 OKF 的 `index.md` 约定。

示例：

```markdown
# Engineering

- [PostgreSQL](postgresql/) - Database operations and troubleshooting
- [Kubernetes](kubernetes/) - Cluster operations and deployment
- [AI Agents](ai-agents/) - Agent frameworks and infrastructure
```

规则：

- 所有知识目录建议维护 `index.md`。
- `index.md` 是导航入口，不是完整知识副本。
- 不重复正文。
- 不将索引页面作为普通 Concept。
- CLI 需要检查索引中的目标是否存在。
- MVP 仅初始化根索引，其他索引人工维护；自动生成、更新和重写后置。

`log.md` 保留 OKF 语义。知识修改历史默认依赖 Git，不要求额外维护重复的人工日志。

链接解析支持普通相对路径和以 `/` 开头的 Bundle-root 路径，均不得逃逸 Bundle；链接中的 `../` 只有在规范化后仍位于 Bundle 内才允许。支持目录链接解析到 `index.md`，链接与 Concept CLI 参数不是同一输入规则。断链输出质量警告，不能导致整个 Bundle 被判为不兼容。

---

## 5. Knowledge Retrieval

### 5.1 Stable Retrieval Contract

Agent 和 Skill 只调用 `akb search`。AKB 负责范围、能力检查及统一结果；替换 QMD / rg 不改变知识格式、Concept ID、引用方式或 Skill。

最小内部接口只需：

- 输入：已解析的 KB 根目录、查询文本、模式、结果数量。
- 输出：Bundle-relative 文件路径、匹配位置、候选片段和可选的后端评分。
- 能力与错误：是否支持所请求模式，以及可识别的依赖 / 索引错误。

范围与路径再次由 AKB 验证；不得信任后端返回的任意绝对路径。索引 setup / refresh / status 是支持索引的适配器能力，rg 不需要模拟索引。

### 5.2 Modes and Implementations

| Mode | QMD | rg | MVP |
|---|---|---|---|
| `keyword` | BM25 | Literal keyword matching | 必须支持两个实现 |
| `semantic` | Vector | 不支持 | 后续按需启用 |
| `hybrid` | Hybrid | 不支持 | 后续按需启用 |

首版默认 `keyword`。rg 将非空查询按空白拆为字面量词项，在同一 Concept 中匹配全部词项，忽略大小写；不把查询当正则或 Shell 代码。按匹配词项的不同正文行数量降序、相同值按路径排序。该匹配规则只约束 rg，不要求复现 BM25 排序。

MVP 明确拒绝尚未启用的 `semantic` / `hybrid` 模式，不静默接受参数。后续开放高级模式时，能力不足的降级也必须遵守 §5.5。

### 5.3 Search Results

```bash
akb search "postgres vacuum" --kb personal --format json
```

目标响应示例：

```json
{
  "schema_version": 1,
  "query": "postgres vacuum",
  "scope": ["personal"],
  "requested_provider": "qmd",
  "provider": "qmd",
  "requested_mode": "keyword",
  "mode": "keyword",
  "degraded": false,
  "degradation_reason": null,
  "results": [
    {
      "kb": "personal",
      "concept_id": "knowledge/engineering/postgresql-vacuum",
      "path": "knowledge/engineering/postgresql-vacuum.md",
      "title": "PostgreSQL VACUUM",
      "line": 12,
      "snippet": "VACUUM can affect replication...",
      "score": 0.91,
      "status": "stable",
      "stale": false
    }
  ]
}
```

- `provider`、`mode` 始终表示实际执行值；降级须提供原因。
- `score` 是可空的后端值，不承诺归一化；rg 返回 `null`，不比较不同实现、模式或版本的分数。
- `line` 无法确定时为 `null`；片段、行号与 Metadata 从当前文件提取，不能拼接旧索引正文与新 Metadata。
- 返回真实 Bundle-relative 路径；文件已删除或越界时排除，不能引用缓存正文代替文件。
- 无结果返回空数组；后端执行失败不能伪装成无结果。
- 人类输出包含相同的关键信息；原始外部工具输出不得污染 JSON stdout。

### 5.4 QMD Adapter and Freshness

通过 QMD CLI 子进程调用，显式传递参数、配置和工作目录，不读取数据库内部结构。

- QMD 是首版交付中的主要检索实现，但不是运行 AKB 的必需依赖；没有 QMD 时仍能使用 rg 完成闭环。
- 对当前 KB 使用独立命名索引、一个 Collection 和用户级受控配置。所有 QMD 调用显式选择该索引，不依赖当前目录的 `.qmd` 配置或默认全局集合。
- 关键词搜索前刷新该 KB 的索引，成功后才查询；刷新失败按 §5.5 降级。刷新与查询在同一 AKB 检索锁中执行，避免多个 AKB 刷新互相干扰。
- 不自动拉取 Git，不启用更新 Hook，不自动信任项目模型配置。
- 模型、索引和临时文件留在用户级缓存，不提交 Git。
- 安装与具体命令参数在固定支持版本后验证并写入使用指南；首版不要求下载 Embedding / Reranker 模型。

每次搜索刷新是小型单 KB 的初始取舍，验收中记录冷启动与重复查询耗时。大规模语料的增量刷新策略在实测需要后增加。外部编辑器仍可能在检索期间修改文件，首版不承诺跨文件快照一致性；最终答案必须读取当前文件。

### 5.5 Fallback and Failure Semantics

- 配置 QMD 但可执行文件缺失、超时、索引刷新或查询失败时，若配置允许，使用 rg 执行关键词检索。
- JSON 返回 `provider: ripgrep`、`mode: keyword`、`degraded: true` 及稳定的原因码；stderr 可附带经过路径与敏感信息处理的诊断。
- 无效参数、越界路径、错误 KB 名称不触发降级。
- 配置 `fallback: none`，或 rg 也不可用时，返回非零依赖故障错误。
- 后续高级模式降级为关键词时同样明确标记，不能声称已执行 Semantic / Hybrid Search。

rg 实现可通过配置直接选择，不只作为异常分支。两个实现不要求排名相同，但都必须返回真实页面和可核验匹配。

### 5.6 Progressive Retrieval and Filtering

1. 强制检查 `--kb NAME` 已提供且该名称已注册。
2. 搜索标题及关键词，获得有限候选。
3. 通过 `akb get` 读取候选的 Metadata 与正文。
4. 必要时读取关联 Concept 和来源。
5. 生成答案，引用 KB 名称、Concept 路径及相关段落，说明证据不足。

禁止加载整个 KB，也不把搜索片段当作已验证事实。首版只提供 Scope 和结果数量限制；type / tags / status / stale 筛选、跨集合排序与候选扩展在实际需要后实现。状态和过期信息仍随结果展示。

---

## 6. Knowledge Ingestion

Knowledge ingestion 是本项目最重要的 Agent 能力。

### 6.1 支持的输入

MVP：

- 本地 Markdown。
- 纯文本。
- Agent 会话中用户直接提供的文本。
- 已存在的 KB 页面。

后续扩展：

- URL。
- PDF。
- HTML。
- GitHub Issues / Pull Requests。
- Google Docs。
- Feishu 文档。
- 其他外部系统。

这些扩展应由 Adapter 或 Agent 已有的工具完成。

**不需要为了摄取文档而开发一个独立的全格式文档解析平台。**

### 6.2 Ingestion Workflow

```text
Input
  |
  v
Read / Extract
  |
  v
Analyze Knowledge
  |
  v
Search Existing KB
  |
  v
Classify:
  - New Topic
  - Existing Topic
  - Duplicate
  - Contradictory
  - Insufficient Evidence
  |
  v
Propose Knowledge Changes
  |
  v
Validate / Review
  |
  v
Write Markdown
  |
  v
Inspect Git Diff
  |
  v
Search Again / Read / Cite
```

语义分析由 Agent 完成；文件校验与写入由 `akb` 负责。

该写入路径仅用于 Create / Update。No-op / Review 在输出决策及理由后结束，不刷新或修改知识文件。

### 6.3 Ingestion Decisions

Agent 必须考虑以下结果：

**Create**

新知识无法自然合并到现有 Concept。

**Update**

新资料增加了已有 Concept 的内容，且信息不存在明显冲突。

**Merge（后续）**

首版仅输出多个页面重复的 Review 建议，不执行跨页面合并、删除或链接迁移。

**No-op**

输入没有提供新的可复用信息。

**Review**

存在矛盾、来源不足、知识可信度不足或重大修改，需要人工检查。

### 6.4 Preventing Knowledge Pollution

非常重要：Agent 不能把所有上下文都写入 KB。

只提炼：

- 可在未来复用的事实。
- 稳定的技术原理。
- 明确的业务规则。
- 已确认的工作流程。
- 有价值的操作经验。
- 可复现的问题及解决方法。
- 值得保留的研究结论。

默认不摄取：

- 临时 Task 状态。
- 未经确认的猜测。
- 重复会话总结。
- 不具备复用价值的对话。
- API Keys、Tokens、Passwords。
- 敏感个人信息。
- 无授权的第三方机密内容。

### 6.5 Duplicate Detection

不自研向量数据库。

首版使用：

1. Agent 比较候选页面的标题和路径。
2. 通过 `akb search` 使用当前配置的关键词检索实现（QMD / rg）。
3. Agent 读取候选正文，判断语义重合与版本差异。

Semantic / Hybrid 检索只在后续开放相应能力后使用，Skill 不直接调用 QMD。

重要原则：

**相似度高不等于重复。**

例如两个 API 版本虽然内容相近，却可能必须分别保存。

所有增量更新及后续合并操作需要保留来源与有价值的差异。

---

## 7. Knowledge Maintenance and Safe Writes

### 7.1 MVP Operations

首版提供 Read / Create / Update / Validate / Search，以及用户自行执行的 Git Diff。废弃可通过更新 `status: deprecated` 完成，不单独开发命令。

关联通过正文 Markdown 链接完成；导航人工维护。自动拆分、合并、移动、批量去重及维护任务后置。

### 7.2 Contradictions and Review

Agent 必须指出冲突结论，比较来源、版本、适用范围和更新时间。能够确认事实更新时提出增量修改并保留来源；无法确定时返回 Review，保留原结论，不写入推测或静默覆盖。

MVP 的 Review 是摄取决策及可读的待审建议，不是团队分支模式、独立 Review Skill 或 PR 平台。No-op / Review 默认不修改文件；报告留在本次输出，不自动生成重复知识页。

### 7.3 Validation Levels

- **格式错误**：无效 YAML、Concept 缺少非空字符串 `type`、保留文件结构不合规。阻止写入。
- **质量警告**：缺少推荐字段、断链、过期、Deprecated、来源或时间字段不符合推荐形状。保留可读性，不冒充 OKF 最小合规错误。
- **安全错误**：路径越界、Symlink Escape、目标覆盖、Hash 不一致。拒绝执行。

Lint 输出稳定的 code、severity、path 和 message。内容来源不明时仍可作为 Draft 保存，但 Agent 不得宣称已验证。

### 7.4 Git and User Changes

MVP 写入目标必须处于所注册 Git Repository，写入保留工作区 Diff，不自动 commit、push、pull、stash 或 reset。

已有用户修改不自动暂存、覆盖或回滚。`get` 返回的 Hash 对应当前工作区内容，Agent 必须基于该版本生成修改；写入后明确列出修改路径。新文件需要 Git add 后才能进入历史，交付指南须说明；未提交的修改不承诺可由 Git 恢复。

### 7.5 Concurrency and Atomic Writes

`get --format json` 返回原始 UTF-8 文件内容及其原始字节 SHA-256。`update` 必须带 `--expect-hash`，不能根据 YAML 重序列化后的内容计算该 Hash。

写入流程：

1. 验证 Bundle、目标路径、Git 状态和候选内容。
2. 取得 Bundle 级 AKB 排他写锁；占用时明确报错，不自动抢锁。
3. 在锁内重新校验目标，比较当前原始字节 Hash；不符则拒绝覆盖。
4. 在目标目录创建临时文件，校验通过后原子替换，保留已有文件权限。
5. 清理临时文件并释放锁；失败时保留原文件，输出可操作错误。

`create` 使用不覆盖已有目标的发布方式，不能以普通替换实现；大小写冲突也拒绝。`--dry-run` 执行相同校验并输出 Diff，不落盘；真正写入时仍需重新校验。

锁只协调 AKB 写入。外部编辑器或其他工具不参与锁，可能存在最后一次检查之后的竞态，首版不宣称对它们提供事务保护；使用说明要求同一工作区避免并行外部写入。异常退出留下的锁须先核实进程已结束，再人工清理，不自动删除未知锁。

首版仅承诺单文件原子操作，不承诺多文件事务。

---

## 8. CLI Design

统一命令名 `akb`。首版只提供闭环需要的命令。

### 8.1 Initialization and Registration

```bash
akb init ./my-kb --git
akb add personal ./my-kb
akb list --format json
akb info --kb personal --format json
akb remove personal
```

`init` 创建最小根 `index.md`；`--git` 在新目录初始化 Git，默认不连接远程或提交。已有同名文件不覆盖；没有 `--git` 时可在已有 Git 根目录初始化 Bundle。首版不在非 Git 目录写知识，须先完成 Git 初始化。

`add` 可按不同名称注册多个 KB；同名拒绝覆盖。`list` 列出所有登记，`remove NAME` 只注销该名称且不删除文件。无默认库，也不实现 `use` 或隐式切换；库级命令必须显式提供 `--kb NAME`。

### 8.2 Search and Read

```bash
akb search "postgres vacuum" --kb personal --limit 10 --format json
akb get knowledge/engineering/postgresql-vacuum --kb personal --format json
```

`get` 返回 `kb`、`concept_id`、`path`、`content`、归一化 Metadata 及原始字节 `hash`。路径仅接受 Bundle-relative Concept ID；知识链接的 `/` 根路径语义由链接解析器单独处理。

### 8.3 Create and Update

```bash
akb create --kb personal \
  --path knowledge/engineering/postgresql-vacuum \
  --from-file /tmp/new-concept.md --dry-run

akb create --kb personal \
  --path knowledge/engineering/postgresql-vacuum \
  --from-file /tmp/new-concept.md

akb update --kb personal \
  --path knowledge/engineering/postgresql-vacuum \
  --from-file /tmp/updated-concept.md \
  --expect-hash SHA256_VALUE --dry-run
```

创建和更新都接收完整 OKF Markdown，不另设计逐字段编辑器。移除 `--dry-run` 执行更新；Hash 冲突时必须重新读取和合并，不能强制覆盖。输入文件允许来自 KB 外部，必须只读并按数据解析；目标只能位于 Bundle 内。

### 8.4 Validation and Search Index

```bash
akb lint --kb personal --format json
akb search-index setup --kb personal
akb search-index refresh --kb personal
akb search-index status --kb personal
```

索引命令只针对当前配置的索引实现。rg 返回明确的 `not_required` 状态，不模拟建立索引。导航生成、Embedding 管理和独立废弃命令后置，避免 `index` 同时表示导航和检索。

### 8.5 Machine-readable Interface

所有上述命令支持 `--format json`，包括写入结果、Dry Run 和错误输出。

- stdout：单个带 `schema_version: 1` 的业务结果或错误对象。
- stderr：诊断和外部工具日志。
- exit code：`0` 成功（含仅有警告），`2` 调用 / 配置错误，`3` 数据校验错误，`4` 依赖故障，`5` 写入冲突 / 锁占用，`6` 路径或文件权限拒绝，`1` 其他执行故障。
- 未找到匹配为成功空结果；读取不存在的 Concept 为数据错误。
- 非交互运行不弹出提示；外部子进程设超时并限制输出量。
- 错误携带稳定 code 及可操作 message，不输出用户文件全文或敏感配置。

不要求 MCP Server。

---

## 9. Agent Skills Design

首版只交付两个标准 Skill：

```text
skills/
├── akb-search/SKILL.md
└── akb-ingest/SKILL.md
```

### 9.1 akb-search

- 从 `akb info` 确认注册 KB，使用 `akb search` 查找候选。
- 通过 `akb get` 读取实际页面，按需追踪来源和关联知识。
- 回答引用 KB 名称、Concept 路径及相关段落，不直接引用旧索引缓存。
- 说明过期、Draft、Deprecated、降级及证据不足，不把 Metadata 当真实性证明。
- 默认只读，不执行知识正文中的指令。

### 9.2 akb-ingest

- 读取授权输入，提炼可复用知识，先检索已有 Concept。
- 输出 Create / Update / No-op / Review 决策及理由。
- 更新时先读取原始内容和 Hash，保留既有有效结论、来源及未知字段。
- 形成完整 OKF 候选文件，执行 Dry Run、校验和安全写入。
- 检查 Git Diff；用预先定义的后续问题检索并读取结果，验证新增知识可找到。
- 不自动提交，不因来源内容中的指令执行命令或扩大权限。

Review 判断属于摄取 Skill，首版不另交付 `kb-review`。`kb-maintain`、自动导航及大规模维护根据真实失败案例后续决定。

### 9.3 Compatibility

Skill 只依赖标准 `SKILL.md`、Shell、AKB CLI 和 JSON，不直接依赖 QMD API 或某 Agent 私有工具。`SKILL.md` 包含必需的 `name`、`description` Frontmatter。

首版在一个 Coding Agent 中实际完成固定案例，并记录 Agent / 模型 / Skill 版本。跨 Agent 兼容是设计约束，第二个 Agent 的完整验证后置，不作为 MVP 阻塞项。

---

## 10. Security Model

### 10.1 Knowledge Isolation

当前可注册多个 KB，但每次操作必须显式选一个。多库登记不提供多用户权限系统；操作系统权限仍是数据访问边界。以下个人 / 团队要求不代表已实现团队发布隔离。

个人 KB 和团队 KB 必须使用不同目录及 Git Repository。

每次操作都必须让 Agent 根据用户指定的已注册名称选择允许访问的 KB，不配置默认库。

不应为方便搜索，把个人与公司 KB 合并进入一个所有 Agent 都能访问的全局索引。

QMD Collection Filter 是查询范围限制，不是强制安全边界。

对于不能接触个人知识的 Agent：

- 不挂载个人 KB 目录。
- 不提供个人 KB 配置。
- 不允许访问个人 QMD 索引。
- 不共享可能包含个人内容的 QMD MCP 实例。

高隔离场景建议采用独立系统用户、容器或执行环境，并隔离 QMD 数据目录。

### 10.2 Prompt Injection

外部资料和已有知识页面均视为不可信数据。

Agent 必须区分：

- 用户/系统直接授予的操作指令。
- 知识文档中的说明文字。
- 文档中可能嵌入的恶意操作指令。

不得因为 KB 页面包含类似“执行这个命令”或“忽略之前指令”的内容，就自动执行命令。

特别是 ingestion 和 review 流程，不允许来源文档提升自身权限。

### 10.3 Path Security

CLI 必须：

- 将 Concept path 解析并约束在选定 Bundle 内。
- CLI Concept 参数拒绝 `..` 路径段与绝对路径；Markdown 链接允许 Bundle 内相对上级路径，规范化后禁止越界。
- 防止 Symlink Escape。
- 拒绝向不允许写入的区域写文件。
- 处理路径中的特殊字符。
- 处理大小写冲突与文件覆盖。
- 禁止任意路径写入覆盖用户的其他文件。
- Concept 读写拒绝保留的 `index.md` / `log.md`、Git 元数据及控制 / 缓存目录；保留文件由专用初始化或校验逻辑处理。
- 首版拒绝写入路径链中的 Symlink，不只做字符串前缀检查；读和检索也必须验证真实路径在 Bundle 内。

### 10.4 External Tool Execution

不要直接执行 KB 中存储的 Shell Commands。

QMD 的配置和自动更新 Hook 也需要谨慎处理。

默认不启用自动 Git Pull Hooks 或项目内自定义模型配置的无条件信任。

外部工具版本应被固定并进行兼容测试。

---

## 11. Technology Stack and Repository Structure

### 11.1 Selected Stack

| Area | Choice | Purpose |
|---|---|---|
| Language / Runtime | TypeScript strict + Node.js LTS | CLI 与核心逻辑 |
| CLI | Commander | 参数、子命令和帮助 |
| Storage format | UTF-8 Markdown + OKF v0.2 | 正文、来源与元数据 |
| YAML | yaml | Frontmatter 解析与校验，保留未知字段 |
| Markdown | remark + remark-gfm | Markdown AST、链接、GFM footnote 与来源对应检查 |
| Retrieval | QMD / ripgrep (`rg`) | 可替换的检索实现 |
| Version control | System Git CLI | 状态、Diff、人工提交 |
| Tests | Vitest | 纯函数、临时文件与 Git 仓库测试 |
| Process / Hash / Filesystem | Node.js standard library | 参数数组子进程、SHA-256、安全文件操作 |

这组技术选择已落实。0.1.0 锁定 Commander 15.0.0、yaml 2.9.1、remark 15.0.1、remark-gfm 4.0.1、TypeScript 6.0.3、Vitest 5.0.4；QMD 适配器验证版本为 2.8.3。Node 引擎范围为 24–26，实际验证环境为 macOS arm64 / Node 26.12.1 和 Linux arm64（Debian 12 / OrbStack Docker）/ Node 24.22.1。完整平台、版本和限制见 [首版验收记录](docs/mvp-validation.md)。后续升级必须验证兼容并锁定，不依赖浮动 `latest`。

npm 分发 `akb` 可执行命令，编译 TypeScript 后运行，不要求终端用户安装 TypeScript 执行器。Git 和 rg 为基础外部依赖；QMD 可选安装，但 QMD 适配器必须完成集成验收。

不添加数据库、ORM、服务端、动态插件框架、独立 LLM SDK 或仅用于少量代码的包装依赖。

### 11.2 Minimal Structure

```text
akb/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── core/
│   │   ├── bundle.ts
│   │   ├── concept.ts
│   │   ├── validation.ts
│   │   └── links.ts
│   └── retrieval/
│       ├── interface.ts
│       ├── qmd.ts
│       └── ripgrep.ts
├── skills/
│   ├── akb-search/SKILL.md
│   └── akb-ingest/SKILL.md
├── tests/
│   └── fixtures/
└── README.md
```

按实际复杂度拆文件，不为每个命令预建空目录或抽象层。解析和校验尽量为纯函数；文件系统、Git 和检索子进程放在清晰边界。

---

## 12. Quality Assurance

### 12.1 Deterministic Checks

Vitest 覆盖实际风险：

- YAML / OKF 最小合规、未知字段保留、保留文件、两种链接路径及断链警告。
- 原始字节 Hash、过期判断与推荐字段警告。
- 路径越界、Symlink Escape、大小写冲突、创建拒绝覆盖。
- 更新 Hash 冲突、AKB 写锁竞争、失败后原文件保留和临时文件清理。
- 完整 CLI Create / Get / Update / Lint / Git Diff 闭环与 JSON 错误协议。
- rg 字面量查询、无结果、特殊字符、稳定排序和范围约束。
- QMD 实际 setup / refresh / search，写入后可检索、外部修改和文件删除后的结果。
- QMD 缺失、超时、刷新失败的降级；rg 也缺失时明确失败。
- 在同一语料上切换 QMD / rg，知识文件与 Skill 不发生变化。

测试使用临时目录、独立配置 / 缓存及 Git 仓库。真实 QMD 集成可单独运行，但没有在受支持环境通过时不得宣称 QMD 验收完成。记录 macOS / Linux 的实际验证情况，未验证的平台明确标注。

### 12.2 Fixed Agent Evaluation Cases

开发 CLI 的同时准备固定输入，避免最后才验证 Agent。每例记录初始 KB、输入、预期决策、必须保留的结论、来源和后续查询。

| Case | Expected decision | Required result |
|---|---|---|
| 独立新主题 | Create | 一篇有来源的 Concept，可由预设查询找到 |
| 已有主题的新增事实 | Update | 原有效结论保留，新事实与来源增量加入 |
| 重复资料 | No-op | 文件内容和知识页数量不变 |
| 来源无法裁决的矛盾 | Review | 原结论不变，输出具体冲突与待审理由 |
| API 不同版本 / 适用范围 | Update 或 Create（逐例预定） | 保留差异，不因相似而错误合并 |
| 证据不足 | Review | 不新增稳定事实，不伪造来源或验证 |
| 输入包含恶意操作指令 | No-op 或 Review（逐例预定） | 不执行指令，不扩大访问范围 |

Create / Update 案例均追加一个不同表述的后续问题，检查目标路径是否在 Top 5、引用是否支持答案。重复摄取同一资料应 No-op。

使用中文、英文和中英混合样例，QMD / rg 分别记录命中率与耗时，不强求排名相同。明确包含关键词的查询必须找到目标；纯语义改写在首版记录失败原因，不宣称已支持语义检索。

### 12.3 Evaluation Record

保留逐例决策、实际 Diff、检索结果、回答引用、人工判定、Agent / 模型版本、工具版本和冷 / 热查询耗时。安全边界、来源伪造、有效结论丢失和冲突静默覆盖必须零失败；未通过时列为阻塞，不以“命令能运行”替代产品验收。

Agent 行为测试与确定性 CLI 测试分开记录；固定案例通过不代表模型对任意输入都有正确性保证。

---

## 13. Implementation Roadmap

### Step 1 — Build the Smallest Working Loop

原 MVP 先实现单 KB 闭环；2026-10-29 扩展为多 KB Registry，库级命令强制显式 `--kb NAME`，保留 OKF Read / Create / Update、Hash 与锁、安全路径、Lint、JSON 和独立检索接口。

同时编写 `akb-ingest`、`akb-search` 的最小版本，在一个真实 Agent 中运行新增、更新、重复和冲突案例。此步骤不要求 QMD 已安装，不能等待所有基础设施完成才验证知识质量。

### Step 2 — Verify Replaceable Retrieval

接入 QMD 关键词适配器，验证独立索引、刷新、一致的结果结构和 rg 降级。对同一语料切换实现，知识文件与 Skill 不变，记录命中结果和耗时。

完成 Step 1 + Step 2，并满足 §14 后，才算首个交付完成。QMD 不被推迟到首个交付之外，但高级模型能力不阻塞该交付。

### Step 3 — Expand Only from Observed Failures

根据固定案例与真实使用记录决定优先级：

- 关键词无法覆盖真实问题：评估 QMD Semantic / Hybrid Search。
- 手工导航造成实际维护负担：增加安全的导航生成。
- 多 KB 注册和显式选库已纳入当前范围；团队需求出现后再考虑发布 Worktree、受保护分支与 Review 模式。
- 重复、过期问题持续出现：考虑 `kb-maintain` 或独立 `kb-review`。
- 外部资料提取成为瓶颈：增加特定来源 Adapter。

不承诺一次实现全部扩展。团队阶段必须另外定义已审内容发布、分支与索引绑定、权限隔离及多 Worktree 验收。

---

## 14. MVP Acceptance Criteria

0.1.0 已按以下范围验收；43 项自动测试和七个独立 Agent 案例的证据、替代决策说明及未测试环境见 [验收记录](docs/mvp-validation.md)。

### Functional

- [x] 能初始化并注册一个 Git Repository 中的 OKF Bundle。
- [x] 能安全创建、读取、更新 Concept，读取返回原始字节 Hash。
- [x] 缺少推荐字段、未知类型或字段、断链不被误判为 OKF 最小格式错误。
- [x] 非法路径、目标已存在、Hash 冲突和 AKB 写锁竞争时拒绝不安全写入。
- [x] 能使用 QMD 关键词检索，并能直接选择 rg 实现。
- [x] QMD 不可用时按配置降级，输出实际后端、模式和原因。
- [x] 替换检索实现无需修改知识文件、Concept ID 或 Skill。
- [x] 更新后能再次检索并从当前文件读取、准确引用知识。
- [x] 两个 Skill 在真实 Agent 中完成固定案例，重复摄取 No-op，无法裁决的矛盾 Review。
- [x] 可以通过 Git 查看修改；无自动提交或混入用户修改。

### Quality and Operations

- [x] 固定案例无伪造来源、有效结论丢失、静默冲突覆盖或恶意指令执行。
- [x] 预设关键词查询在两个实现中均可于 Top 5 找到目标；语义改写结果分别记录。
- [x] 核心风险有自动化测试；真实 QMD 集成验证通过且记录支持版本。
- [x] JSON 输出和错误码稳定；外部工具无无限等待或意外提示。
- [x] 无常驻服务、外部数据库或额外 LLM API Key。
- [x] 设计面向 macOS / Linux；交付记录列出实际测试平台与已知限制。
- [x] 索引 / 缓存不进入知识仓库；移除工具后知识仍可读、可迁移。

原 MVP 验收没有覆盖多 KB；后续多 KB 和强制选库验证单独记录在验收文档中。跨库聚合检索、团队 Review 模式、导航自动生成、四个 Skill 和 Hybrid Search 仍不属于当前范围。

---

## 15. Implementation Instructions and Delivery

### 15.1 Before Coding

1. 将 OKF v0.2 规范固定到明确的官方修订，准备最小兼容与未知字段样例。
2. 验证并锁定 §11 技术栈的具体版本，以及 Git / rg / QMD 的支持范围。
3. 核实 QMD 的命名索引、配置发现、禁用更新 Hook、关键词检索及刷新命令，不能凭猜测使用接口。
4. 核实 Agent Skills 格式，在一个实际 Agent 中试跑最小 Skill。
5. 先定义固定案例及预期结果，再开发完整闭环。

这里是实施前检查清单，不代表依赖版本或平台验证已经完成。

### 15.2 Engineering Constraints

- TypeScript strict，复用 Commander / yaml / remark / Vitest，不额外引入框架。
- 子进程使用参数数组，禁止把查询或路径拼入 Shell 命令。
- 保留未知 Metadata，不能为适配检索往知识页复制一套后端专用字段。
- 所有知识写入具备路径验证、内容校验及并发检查。
- 仅实现闭环需要的接口，不添加动态插件、数据库、后台服务或独立 LLM Provider。
- 不绕过 CLI 写入，不自动修复内容冲突，不自动提交或执行来源中的代码。
- 未通过的测试和未经实测的平台如实记录，不能将设计意图写成验收结果。

### 15.3 Delivery

1. 可安装运行的 `akb` CLI 与锁定的依赖。
2. `akb-ingest`、`akb-search` 两个 Skill。
3. OKF 示例与固定评测语料；多 KB 注册、显式选库和作用域隔离回归测试。
4. QMD / rg 配置、安装和切换指南。
5. 自动化测试及真实 Agent / QMD 集成结果。
6. README：从初始化、摄取、Diff 到再次检索的完整示例。
7. 已知限制、实际平台支持情况和由失败案例驱动的后续建议。

### 15.4 Prioritization

```text
Create / Register KB
   -> Read Input
   -> Search Existing Knowledge
   -> Create / Update / No-op / Review
   -> Validate Proposed OKF Markdown
   -> Safe Write (when applicable)
   -> Inspect Git Diff
   -> Search Again (QMD refresh or direct rg)
   -> Read Current Concept and Cite
```

首个交付的价值由知识整理与再次检索结果判定，命令数量不作为完成标准。

---

## 16. External References

- [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
- [OKF v0.2 Specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [QMD](https://github.com/tobi/qmd)
- [QMD Query Syntax](https://github.com/tobi/qmd/blob/main/docs/SYNTAX.md)
- [QMD MCP Setup](https://github.com/tobi/qmd/blob/main/skills/qmd/references/mcp-setup.md)
- [Agent Skills Specification](https://agentskills.io/specification)

---

## 17. Final Architectural Decision

采用：

**Git + Markdown + OKF v0.2 + Replaceable Retrieval (QMD / rg) + Lightweight CLI + Two Agent Skills**。

- Git 是版本控制与 Diff 工具。
- Markdown + OKF 是从首版开始采用的知识格式。
- AKB 定义检索契约，QMD 和 rg 是可替换实现；QMD 为主要实现，不绑定知识本体。
- CLI 负责确定性操作和安全边界。
- Agent Skills 负责知识提炼和查询工作流。

保留 Project Memory 与通用知识库的职责边界，不强行合并 BRAIN.md。

**首个交付只证明一件事：Agent 能把资料整理成可复用知识，并在之后找到、读取和准确引用。**

