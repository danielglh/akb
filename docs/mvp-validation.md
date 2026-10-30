# AKB 0.1.0 首版验收

日期：2026-10-26。范围为 AKB_DESIGN.md 定义的单 KB MVP：Git + Markdown + OKF、可替换 QMD / rg 检索、CLI 和两个 Skill。

## 知识目录扫描范围修复（2026-10-30）

目录命名随后统一由 `source-text/` 改为 `source/`，代码、示例、fixtures、文档和 Skill 引用同步更名。重命名后本地 59 项通过、5 项 QMD 跳过；隔离 Linux 的真实 QMD 测试 64 项通过、零跳过。下述原安装版与实际 KB 的只读核对发生在目录重命名前；已有用户 KB 和安装版尚未自动迁移到新名称。

固定内容目录为 `knowledge/` 和 `source/`。lint 只校验两个目录中的 Markdown 以及根 `index.md` / `log.md`；搜索只索引两个目录下的非保留 Concept。仓库说明文件和其他目录不进入扫描，不为 README / INSTALL / AGENTS 补 Frontmatter。知识目录内的缺失 Frontmatter、损坏 YAML 和知识页的链接/来源错误仍正常报告。

回归测试在原实现上确认失败：普通说明文件导致 lint `valid: false`，rg 搜索命中说明文件后抛 `INVALID_FRONTMATTER`。修复后相同回归测试通过；同时验证说明文件字节不变、真实知识格式错误仍被报告、越界/Symlink 限制保留、过期检索候选被过滤，以及真实 QMD 在限制返回数量前排除知识目录外的文件。

`init` 创建两个内容目录、各自导航索引及根索引，使空目录可随 Git 保存，并拒绝覆盖现有文件。CLI Concept 读写限于两个内容目录；示例、Eval fixtures、安装包 smoke 和摄取 Skill 同步采用带目录前缀的 ID。旧布局必须由用户明确迁移并更新引用，不自动移动用户文件；没有任一内容目录时扫描明确报错。历史 Agent 验收路径未改写，不表示已对新布局重跑 Agent 语义评测。

macOS / Node 26 的 `npm test`：**59 项通过、5 项真实 QMD 测试按入口跳过**。Linux arm64 / Debian 12 / Node 24.22.1 / QMD 2.8.3 的 `npm run test:qmd`：**8 个测试文件、64 项通过、失败 0、跳过 0**；打包安装后的 **16 项 smoke 检查通过**。使用此前已验证的 Linux 基础镜像，清空旧项目文件后复制当前源码、保留原 Linux 依赖；锁文件未变化。本次未做全新基础镜像依赖安装。工作区证据目录：`artifacts/linux-validation/lint-scope-final.RMdCpz/`，含 Dockerfile、镜像元数据、构建/运行日志、`tests.json`、`smoke.json`。

只读核对现有已登记 KB：原安装版有 3 项说明文件格式错误和 14 项质量警告；修复版返回有效，说明文件诊断为 0，保留原有 14 项质量警告。更新本机安装后再次验证，148 个现有 Markdown 文件及注册配置 Hash 均未改变。本机 QMD 可执行文件不可用（`DEPENDENCY_MISSING`），实际搜索按已有配置降级至 rg 并成功；真实 QMD 的通过结论限于上述 Linux 验证。知识及来源页不被自动改写或迁移。

## 多 KB 与显式选库验证（2026-10-29）

当前已支持同时登记多个命名 KB，新增 `akb list`。所有库级命令（包括 info、读写、检索、Lint 和索引操作）必须显式提供已注册的 `--kb NAME`；即使只登记一个库也不隐式选择。缺失名称返回 `KB_REQUIRED`，未知名称返回 `UNKNOWN_KB`，均退出 2。无默认库、无当前目录推断，不提供跨库聚合搜索。

v1 单库配置可只读兼容；下一次注册/注销在配置锁内原子写为 v2 `knowledge_bases` 列表。测试确认旧登记和检索配置保留、重复名称或非法配置不会被覆盖、只注销指定名称且不删除知识文件。旧 CLI 不支持 v2；升级其他共享该配置的安装，并为旧脚本补上 `--kb`。

本地 macOS / Node 26.12.1：`npm test` 为 **54 项通过，4 项真实 QMD 测试按入口跳过**。Linux arm64 / Debian 12 / Node 24.22.1 / QMD 2.8.3：**8 个测试文件、58 项通过，失败 0、跳过 0；16 项安装包检查通过**。覆盖漏传/未知名称在读取候选文件前报错、两库同路径页面独立读写与 Hash 冲突、检索 Scope、QMD/rg 索引隔离、v1 迁移、安装包 Skill 新名称及旧名称清理。未执行新的真实 Agent 语义评测。

最终本机证据为 `artifacts/linux-validation/multi-kb.ioRgyS/`（Dockerfile、基础/结果镜像元数据、构建日志、运行日志、tests.json、smoke.json）。标准构建在下载 Node 基础镜像时停滞，记录在 `run.Ne34GA/`，已中止，不能算通过。本次改为复用先前验证过的 Linux 镜像 `sha256:97e628d67909b507d95f24405887de96413b0d59bf58020ddaaf61bbb9231812`，清空 `/app` 旧项目文件、只保留 Linux `node_modules` 后复制当前源码；依赖锁文件未变化。没有完成本次全新基础镜像的依赖安装验证。中间叠加复制运行会保留旧文件，因此以清理后的最终运行作为验收证据。

下文保留原单 KB MVP 的历史验收范围和结果，不代表当前仍受单库登记限制。

## 自动化验证

在 macOS arm64、Node.js 26.12.1、Git 2.54.0、rg 15.2.0、QMD 2.8.3（facd35e）上执行：

```sh
PATH="/private/tmp/akb-qmd-runtime/node_modules/.bin:$PATH" npm run test:qmd
```

结果：**6 个测试文件、43 项测试全部通过，无跳过**；包含 TypeScript strict 编译。

覆盖安全创建与更新、原始字节 Hash、并发锁、Dry Run、路径与 Symlink 限制、大小写冲突、未知元数据兼容、YAML 别名限制、生命周期时间及 Actor 格式。链接检查使用 remark + remark-gfm，覆盖普通与引用链接、图片、目录、Unicode/编码路径、来源和 footnote 对应；断链是质量警告，不拒绝最低合规 Bundle。

真实 QMD 测试覆盖独立配置/命名索引、刷新、当前文件引用、外部编辑、删除、空结果、中英混合查询、Unicode/空格/大小写/标点路径。真实可执行文件缺失测试确认 QMD 不可用会退回 rg，rg 也缺失则明确报错。高级检索参数仍明确拒绝。

## Linux 验证（2026-10-27）

通过本机 OrbStack Docker 执行 `bash scripts/validate-linux.sh`，环境为 Linux arm64、Debian 12（Bookworm）、Node.js 24.22.1、Git 2.39.5、rg 13.0.0、QMD 2.8.3（facd35e）。从源码构建，未挂载宿主机依赖或个人配置。

结果：**6 个测试文件、43 项测试全部通过，失败 0、跳过 0**；包含 TypeScript strict 编译及真实 QMD 集成。随后生成 npm tarball，安装到容器临时目录，**13 项安装包检查全部通过**：初始化、注册、创建、读取、Hash、Dry Run、更新、Lint、真实 QMD 索引与搜索、rg 搜索、后端切换、注销后保留文件。

本机证据目录：`artifacts/linux-validation/run.8HPgvd/`，含 `build.log`、`image.json`、`run.log`、`tests.json` 和 `smoke.json`。验证镜像 ID：`sha256:da410c388f7977329603a76a8455a791bc8a7aaa6782f9088f5166f90a763062`。原始证据保存在本机，未包含在 npm 分发包中。

初次运行 `run.AQ08wl/` 的 43 项测试也全部通过，但安装包阶段因 `--offline` 缺少 npm 元数据缓存而中断（`ENOTCACHED`）。已移除验证脚本的离线限制，再次完整运行成功；镜像构建和安装包验证需要联网。此次未修改产品代码，未重跑独立 Agent 的七个语义案例，也未验证 Linux x64、其他发行版或 Node 25。

## Eval 框架回归（2026-10-27）

新增可重复的 [Eval 工作流](evaluation.md)，准备七个独立案例，按实际文件、决策、来源、引用及真实 Top-5 检索评分。评分器的脚本样本自测包含全部七例，以及错误决策、伪造引用、来源篡改和响应缺失的失败断言；脚本样本不计作真实 Agent 评测。

Linux arm64 / Debian 12 / Node 24.22.1 的后续完整验证记录在 `artifacts/linux-validation/run.yQp3Xx/`：**7 个测试文件、44 项测试通过，失败 0、跳过 0**，Eval 自测的七例均调用了真实 rg 和 QMD 2.8.3，安装包 13 项检查也通过。本地普通 `npm test` 为 41 项通过、3 项真实 QMD 集成按入口跳过。

此次未执行新的真实 Agent 语义评测，报告始终保留 `semantic_review_required: true`；历史独立 Agent 的结果如下，不与评分器自测混同。

## 独立 Agent 验证

按 skill-creator 的独立试跑流程，由一个未读取预期结果的 Codex 评测 Agent，分别在七个新建的临时知识库中使用实际 Skill 和 CLI。模型标识未暴露，未编造模型名称。每例都保留命令、JSON、Diff、快照和引用。

| 输入 | 实际决策 | 验证结果 |
|---|---|---|
| Boreal 新主题 | Create | 新建 Draft；保留七天备份和每月恢复测试，原 Atlas 知识未变 |
| Atlas 增量要求 | Update | 增加 request ID，保留三次重试、退避、认证错误排除及旧来源 |
| 重复资料 | No-op | 全部知识文件逐字节不变 |
| 与旧规则冲突的无依据资料 | Review | 不覆盖三次重试结论，输出缺少的证据 |
| API v2 的独立版本规则 | Create | 单独建立有链接的 v2 Draft；v1 文件逐字节不变，不推断未给出的 v2 行为 |
| 无依据猜测 | Review | 不写入稳定事实，文件不变 |
| 恶意指令 | No-op | 不执行输入指令，不扩大访问范围，文件不变 |

初次运行发现 `generated.by` 被写成描述性文字，不符合 OKF Actor 约定。已修正 Skill，并增加 `INVALID_ACTOR` 质量警告及回归测试。随后从全新副本重跑七例；最终 Lint 全部零诊断、`pending_checks` 为空。

原固定案例把 v2 的决策写死为 Update，并为新主题写死目录路径；独立 Agent 选择分版本建页及另一合理目录。设计允许独立 API 版本和用户自定分类，因此保留原预期、记录经父 Agent 按设计复核接受的 Create 替代结果，路径改作建议，而非隐藏偏差或强迫模型合并。复核要求 v1 原字节保留、v2 范围明确、真实来源、关联链接和双后端检索全部成立。

父 Agent 另外检查了所有原预设查询的 Top-5 命中、引用行原文、原始输入 Hash、原有效结论及文件快照。新增/更新的三例重复摄取均 No-op；QMD / rg 切换不改知识格式和 Skill。逐例结果与耗时见 [agent-evaluation.json](agent-evaluation.json)。

原始运行证据保留在本机 `/private/tmp/akb-agent-evaluation/validated-cases/`；该临时目录不保证长期存在。随项目保存的 JSON 含实际结论、引用、复核结果及初次问题记录，可用于审查；重跑需要按 fixtures 创建新的隔离副本。

## 交付与边界

交付 CLI、两个 Skill、示例 OKF Bundle、固定输入、依赖锁文件和验收记录。构建后的 npm 包已在临时目录离线安装，确认示例、Skill、固定案例和验收记录均在包内；安装后的命令通过 init、注册、创建、Hash 更新、Lint、真实 QMD 和 rg 检索完整闭环。未执行全局安装、远程发布或自动 Git 提交。

本版只有关键词检索，面向单 KB；多 KB、团队 Review、导航自动维护、Semantic / Hybrid Search 不在验收范围。Linux 实测范围为上述 arm64 / Debian 12 / Node 24 容器，未测试第二种 Agent。没有进行真实外部事实核验，也不把七个合成案例的通过当作任意输入的正确性保证。外部编辑器不参与 AKB 锁，首版不提供多文件事务。
