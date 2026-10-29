# 可重复的 Agent Eval

框架复用 `tests/fixtures/ingest/cases.json` 的七个案例，准备真实 CLI 可操作的知识库，再独立检查 Agent 留下的结果。无需新增依赖、模型 API Key 或全局安装。评分器只检查可观测断言；报告的 `automated_passed` 不等于语义评审通过。

## 准备

需要源码 checkout、已安装的项目依赖、Node 24–26、Git 和 rg。在源码项目根目录运行（npm 安装包不包含此开发工具）：

```sh
npm run eval:prepare
```

最后一行输出新建的绝对运行目录，默认在系统临时目录下。也可指定保存位置，每次创建新目录，不覆盖旧运行：

```sh
npm run eval:prepare -- ./artifacts/eval
```

每个案例都有独立的 `kb/` Git 仓库、原始 `input.txt`、隔离的 XDG 配置/缓存及 `task.md`。初始后端为 rg，不修改个人知识库或个人配置。`manifest.json` 保存创建时间、用例预期、输入与初始知识文件 Hash，以及 CLI 入口和 Skill 的 Hash；`baseline/` 保留初始知识副本。临时目录可能被系统清理，长期证据应保存到 `artifacts/eval/` 等持久位置。

## 执行 Agent

让待测 Agent 在新的上下文中读取一个案例的 `task.md` 并完成摄取，七个案例分别执行。任务文件只提供输入、Skill、CLI 路径及输出协议，不包含标准答案。Agent 必须在每次 CLI 调用中使用该案例指定的 `XDG_CONFIG_HOME` 和 `XDG_CACHE_HOME`，只通过 CLI 写入知识，并在所有库级命令中显式提供 `--kb evaluation`；不允许隐式选库。

Agent 最后写入该案例的 `response.json`，例如：

```json
{
  "agent": "actual-agent/model-or-unknown",
  "decision": "Update",
  "reason": "新增 request ID 要求，保留旧版重试规则和来源。",
  "citation": {
    "path": "engineering/atlas-retries.md",
    "line": 29,
    "excerpt": "Include a request ID in retry diagnostics.[^supplied]"
  }
}
```

行号和引用必须来自本次实际文件，示例不能直接当作运行结果。No-op / Review 同样需引用现有知识。不同版本可以按 fixtures 允许的替代决策单独建页；评分器会要求 v1 原始字节不变、保留版本事实并链接旧页。保存新增来源时使用任务文件给出的 `file:` URI。

框架不自动调用特定 Agent 或支付模型费用，也不执行资料中的指令。任务文件的范围约定不是操作系统隔离：有整个项目访问权限的 Agent 仍可能读到答案，评分器也无法证明未发生外部访问、未绕过 CLI 或未执行恶意指令。需要独立环境时，应由执行方使用容器/文件权限限制访问，并保留 Agent 命令日志。

## 评分

将实际运行目录传给评分器：

```sh
npm run eval:grade -- /absolute/path/to/run.DIRECTORY
```

默认使用真实 rg 验证 Top-5 检索。明确验证两个后端时，先确保 PATH 上有真实 QMD 2.8.3，再运行：

```sh
npm run eval:grade -- /absolute/path/to/run.DIRECTORY ripgrep qmd
```

QMD 不允许降级；不可用会判该项失败。评分时临时切换该案例的后端，结束后恢复配置。报告写入运行目录的 `report.json`；所有案例断言通过退出 0，任一失败退出 1。响应缺失也判失败，不跳过。基线被篡改则停止评分。

自动检查包括：

- 决策符合预期或明确允许的替代；保留 Agent 身份、理由和引用。
- No-op / Review 的全部知识文件（含来源文件）逐字节不变；Create / Update 只改一个预期范围内的 Concept，不删除旧文件。
- 正文包含预设关键词、原 Atlas 规则与来源保留；变更保持 Draft，新增来源和脚注对应，未沿用 verified。
- Lint 无诊断和未执行检查；引用行的原文与当前文件一致。
- 目标 Concept 出现在指定后端的真实 Top 5，记录实际返回结果和耗时；记录文件 Hash、逐项失败原因和通过案例数。

检查使用固定英文词组，合理的同义改写也可能失败；关键词出现、来源存在及引用字节一致，均不能证明结论与来源语义一致。`semantic_review_required` 始终为 `true`，仍需复核事实是否完整、是否伪造/误用来源、版本是否误合并、Review 理由是否充分。此版未自动执行重复摄取或评价最终问答的语义正确性。

## 框架自身的回归测试

```sh
npm test
```

`tests/eval.test.ts` 通过 CLI 写入脚本构造的输出，验证七例的评分通路，并注入错误决策、伪造引用、来源文件篡改和缺失响应，确认评分器拒绝。使用 `npm run test:qmd` 时，自测的七例会同时检验真实 rg 与 QMD 检索；普通 `npm test` 只要求 rg。这是评分器测试，不能当作真实 Agent 的通过记录。真实评测必须另行执行上述 Agent 步骤，保留运行目录及命令日志；不会重用历史 `docs/agent-evaluation.json` 作为新结果。
