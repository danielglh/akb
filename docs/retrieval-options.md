# Agent 检索工具调研

日期：2026-10-27。基于项目官方 README 和文档的案头调研，未安装这些候选，也未复现其性能宣传。本次没有修改 AKB 的检索实现或引入新依赖。

## 结论

面向 Agent 的 grep 类工具已有多条路线。与 AKB 最相关的两个候选是 **Probe**（无 Embedding 的结构化上下文检索）和 **ColGREP**（本地模型、语义排序并支持 Markdown）。值得研究的能力包括按语义块返回结果、输出预算和避免重复上下文，而不仅是更快扫描字符串。

代码检索基准的优势不能直接证明中文知识库上的优势；以下 AKB 适配判断均为基于功能和部署要求的工程判断，不是实测排名。

## 候选比较

| 工具 | Agent 优化点 | 依赖与运行方式 | 对 AKB 的判断 |
|---|---|---|---|
| [Probe](https://github.com/probelabs/probe) | ripgrep + Tree-sitter、BM25/布尔查询、完整语义块、JSON、Token 预算及会话去重 | 核心 search 不要求 Embedding；另有可选 Agent/LSP 能力 | **优先候选**；官方定位包含代码和 Markdown，可先验证文档分块及预算控制 |
| [ColGREP](https://github.com/lightonai/next-plaid/blob/main/colgrep/README.md) | 本地多向量语义排序、关键词/正则/混合模式、路径和行范围、JSON | Rust CLI、本地模型和索引；搜索时自动更新 | **优先候选**；明确支持 `.md`/`.mdx`，但代码模型对中文知识的收益待测 |
| [grepai](https://github.com/yoanbernabeu/grepai) | 自然语言找代码、调用图、MCP | Embedding Provider：默认 Ollama，也支持 LM Studio/OpenAI；文档工作流使用 watch | 更适合代码；其模型服务/维护方式应与 AKB 无必需常驻服务的目标比较 |
| [osgrep](https://github.com/Ryandonofrio3/osgrep) | 本地 Embedding、符号角色和调用图、按仓库隔离索引 | ONNX 模型；支持按需索引和可选热驻服务 | 默认重点是代码/配置，无解析器文件需 fallback；不是 Markdown 的直接替换首选 |
| [mgrep](https://github.com/mixedbread-ai/mgrep) | 自然语言、多模态、Agent 集成、相关性排序 | Mixedbread 登录/API Key 和云端 Store；watch 同步文件 | 默认云同步方式与 AKB Local-first 目标不符，不推荐作为默认实现 |
| [ast-grep](https://github.com/ast-grep/ast-grep) | 用 AST 模式精确查代码结构，可输出匹配并重写 | 本地结构化模式匹配，不是向量语义检索 | 适合代码分析与修改；对 Markdown 知识检索帮助有限 |
| [mdq（yshavit）](https://github.com/yshavit/mdq) | 像 jq 一样选取 Markdown 元素 | 本地 Markdown 查询 CLI | 更像检索命中后的内容提取补充，可借鉴到按章节读取 |
| [ripgrep-all / rga](https://github.com/phiresky/ripgrep-all) | 对 PDF、Office、压缩包等做文本检索 | rg + 格式转换适配器及相应外部工具 | 解决原始资料格式覆盖；不能替代整理后的 OKF 知识检索 |

Probe 的核心搜索机制和预算参数见 [官方搜索文档](https://github.com/probelabs/probe/blob/main/docs/probe-cli/search.md)。ColGREP 的 `--agent` 是额外的 Agent 模式，不应把它的模型开销和基础语义检索混为一谈；JSON 输出目前始终含绝对路径，接入 AKB 时必须重新约束并归一化。

同名项目需要区分：这里的 Probe 指 `probelabs/probe`，mdq 指 `yshavit/mdq`；它们不等同于其他作者的同名项目。比如另一个 [mdq](https://github.com/aaronshaf/mdq) 依赖 Meilisearch，其运维取舍不同。

## 对现有实现的含义

建议继续保留 `akb search` 的稳定接口和 rg 的基础能力，先比较 Probe、ColGREP 与现有 QMD，而不是把 Skill 直接绑定到某个新命令。mgrep 的默认云服务和其他工具的可选后台进程也不能被“Agent 优化”这个标签掩盖。

下一步实验应使用同一批中英混合 OKF 页面，固定查询、Scope、Top-K 和返回预算，分别记录：

- 精确词、不同措辞、中文和中英混合问题的命中与引用支持度。
- 输入 Token/输出字节、Agent 需要的工具轮数；不能只比较单次搜索耗时。
- 首次建索引、热查询、文件更新和删除后的耗时与正确性。
- 模型下载、内存/磁盘、后台服务及外网调用要求。
- 索引与真实文件路径的一致性，以及越界结果是否被 AKB 拒绝。

先测纯检索能力，不启用候选工具自带的回答 Agent 或自动全局安装。若 Probe 的 Markdown 语义块已经降低上下文成本，就不需要为这个收益额外引入模型；若 ColGREP 在不同措辞和中文问题上有实测收益，再考虑增加适配器。
