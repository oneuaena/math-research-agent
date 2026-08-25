# Math Research Agent

[English](README.md) | [简体中文](README.zh-CN.md)

**一个面向实验数学与猜想探索、强调可复现和可审计的自主研究工作台。**

Math Research Agent 是一款本地优先的 Electron 桌面应用，用于组织模型辅助的数学探索。它把持久化研究树、结构化实验、证明尝试、怀疑性审查、证据等级、预算和 checkpoint/resume 放在同一个桌面工作空间中。

本项目是独立开源项目。OpenAI-compatible API、DeepSeek、OpenAI、Anthropic、Microsoft、Lean、SageMath 或大学名称仅用于事实性的兼容说明，不代表隶属、授权或背书。

## 下载

### Windows 10/11 x64

- **[安装包（.exe）](https://github.com/oneuaena/math-research-agent/releases/download/v2.0.0/Math-Research-Agent-Setup-2.0.0.exe)** — SHA-256 `A2CCFFA89ED2F7A4D4D327E01924CB35CACE7A0CC5DE751BF03829522AA03284`
- **[免安装软件 ZIP](https://github.com/oneuaena/math-research-agent/releases/download/v2.0.0/Math-Research-Agent-2.0.0-Windows-Software.zip)** — SHA-256 `31EF9E5B32B434F6E8F2B4E2BB2CD8A93F233F9D91428226C65A1E2F2617C3E2`

### macOS 13 或更高版本

- **[Apple Silicon（M1/M2/M3/M4/M5）](https://github.com/oneuaena/math-research-agent/releases/download/v2.0.0/Math-Research-Agent-2.0.0-mac-arm64.zip)** — SHA-256 `12FC4ECB6FCB6FCF90CC3237505534766A9773DEBBFC25075702E16F54E22B13`
- **[Intel Mac](https://github.com/oneuaena/math-research-agent/releases/download/v2.0.0/Math-Research-Agent-2.0.0-mac-x64.zip)** — SHA-256 `ADBC85B7C6CEB8C90B43A6C29F77255BC1BF25D2031E1C43F25171F13985A071`

Windows 用户运行安装包或解压免安装 ZIP；Mac 用户解压后把应用拖入“应用程序”目录再打开。启动后进入“设置”，填写自己的 Provider、Base URL、模型和 API Key，并运行“运行环境检查”。

安装包已经内置 Python 3.12、SymPy、NumPy、SciPy 和 Z3。普通用户**不需要**安装 Node.js/Python，不需要执行 `npm install`、`pip install`，不需要修改 PATH；默认按当前用户安装，也不需要管理员权限。

由于独立开源发行版没有商业代码签名证书，Windows SmartScreen 可能显示“Unknown publisher / 未知发布者”。Mac 应用同样未签名、未公证，首次启动可能需要按住 Control 点击应用并选择“打开”。请核对公开的 SHA-256，不要全局关闭系统安全功能。

## 项目概览

应用目前可以：

- 把自然语言问题转换为经过 schema 校验的结构化规格；
- 使用不同研究角色运行有界、持久化的自主研究流程；
- 对有限构造进行带 seed 的种群、变异/重组、Pareto/新颖性归档和受限真实 worker 线程评估；
- 维护研究分支、证据、失败路线、证明步骤和证明图；
- 执行受限 Python、SymPy、NumPy、SciPy、有界 Z3 检查和真实 Lean 4 内核检查；
- 对 PDF、DOCX、文本、Markdown、LaTeX 文档提取并索引文本，供有界研究上下文和来源感知对话使用；
- 在提升任何验证标签之前批判候选论证；
- 暂停、创建 checkpoint、恢复中断会话，并从已保存的下一阶段继续；
- 使用确定性的本地协调器或 OpenAI-compatible 模型 Provider；
- 在本地 SQLite 中保存项目，并导出 Markdown、LaTeX 或反例证据。

## 重要的认识论边界

> **LLM 生成的论证不会自动成为证明。SURVIVED TESTING ≠ PROOF（通过测试不等于证明）。**

项目区分不同证据等级：

| 标签 | 含义 |
| --- | --- |
| `NUMERICALLY SUPPORTED` | 近似数值或抽样结果在明确范围内支持结论。 |
| `COMPUTATIONALLY VERIFIED` | 有记录的机器计算检查了一个有界命题或工件。 |
| `SYMBOLICALLY VERIFIED` | 符号系统检查了指定变换或恒等式。 |
| `EXACTLY VERIFIED` | 精确算术或可复跑的精确见证检查了所述命题。 |
| `FORMALLY VERIFIED` | 若要提升为原始自然语言命题的形式化验证，必须同时有用户确认的冻结映射、精确证明关联、独立审查、所有关键步骤有效和 Lean 内核接受。AI 提议的映射即使被 Lean 接受，也只标为 `LEAN STATEMENT ONLY`。 |
| `LLM ASSESSED ONLY` | 只有模型判断，没有独立机器或形式化证据。 |

只要关键步骤无效、未解决、需要缺失引理，或缺少必要计算/形式化，候选证明就仍是不确定的。详见[数学验证规范](docs/VERIFICATION.md)。

## 形式化映射门

形式证明有两个不同的问题：Lean 是否接受某个声明，以及这个声明是否忠实表示用户的原始自然语言命题。应用不会把两者混为一谈。

1. 在 `FORMALIZE` 阶段，Provider 可以随结构化 Formal IR 给出一个**不含证明体**的 Lean 声明头。主进程会在证明执行前冻结归一化后的原始命题、Formal IR、声明及其 SHA-256 标识。
2. 每次 `lean_check` 都必须引用已有的冻结 `bindingId`，且源代码中的声明头必须精确哈希匹配。缺少 ID、替换声明或旧版/不完整绑定都会在调用 Lean 前被拒绝；Provider 的原生工具调用也经过同一检查。
3. AI 提议的映射会明确记录为 `LEAN STATEMENT ONLY — original-language equivalence not independently certified`，不能把原始命题提升为已验证证明。
4. 在 Formal Lab 中，用户可明确确认并冻结映射。只有这一范围才有资格进入现有的独立审查证明提升门；Lean 内核本身仍只证明 Lean 声明，而不会自动证明自然语言翻译正确。

冻结绑定是主进程记录；渲染进程不能通过通用记录接口保存或删除它们。这能防止 UI/模型意外替换溯源链，但不能自动解决一般性的语义等价问题。

## 2.0：发现、证明搜索与证据闭环

2.0 将有限构造发现接入了自主研究主循环。模型可以在形式化时提出**纯数据**的候选表示和 evaluator；主进程会先做 schema、静态边界、小规模和对抗性输入校验，只有通过的规格才会进入 `DISCOVERY_SEARCH`。搜索会保存 evaluator 哈希、seed、策略、候选、目标值、约束结果和证书，再进入 `DISCOVERY_ANALYZE`、引理、冻结绑定上的 Lean 证明搜索、批判和重规划。无效规格只留下失败审计记录，绝不会启动 evaluator。

候选层支持集合/子集、元组、序列、排列、矩阵、图、超图、整数/布尔向量、结构化对象和非可执行表达式树 DSL。evaluator 同样是版本化声明式数据：基数、范围、互异、禁止元组/超边、覆盖、网格三点共线和表达式大小等约束，以及 Pareto、字典序和加权目标；其中没有 `eval`、任意 Python、shell、网络、文件或进程执行。

形式证明搜索仅能对既有冻结 Formal Binding 运行：它记录 Lean 目标探测、受限 tactic 提案、独立编译、部分/失败状态和 beam；只有 Lean 内核接受同一个冻结声明才可认证。`AI_PROPOSED` 映射始终只是 `LEAN STATEMENT ONLY`，不能自动等同于原自然语言命题。跨项目知识库也只检索带来源与原验证等级的记录，不会把旧笔记升级成事实。

内置固定 benchmark 分为 Level 1–4，保存解决率、形式证明率、评估调用数、耗时和 `falseVerifiedRate`。Level 4 的 N71 仅验证 `71 × 71`、142 点、无三点共线的表示/评估器能被安全表达；它不会把开放问题标为已解决。

## 已实现功能

- 中文默认界面，可切换英文。
- 形式化、规划、探索、实验、模式发现、引理生成、证明尝试、批判、验证、综合、重规划和 checkpoint 等自主阶段。
- 可配置迭代次数、总时长、分支数、工具超时、Provider 超时和 checkpoint 间隔。
- 类型化研究节点、图边、证据记录、证明文档和逐步审查状态。
- 使用内置合成示例进行可复现、精确的反例压力测试。
- 项目研究对话支持明确的研究控制路由，并从已导入文档检索有界上下文。
- 本地文档提取与分块索引，以及可选的 arXiv/Crossref 文献检索。
- Python、SymPy、Z3、Lean 工具运行保留精确输入、分离的输出/错误、超时和严格证据等级审计。
- 冻结 Formal Binding Gate：FORMALIZE 阶段声明绑定、哈希匹配的 Lean 调用、映射范围标签，以及 Formal Lab 的两步确认流程。
- OpenAI-compatible `/chat/completions` 传输层，支持有限重试、SSE 归一化、工具调用、reasoning 字段兼容和结构化 JSON 恢复。
- 本地导出 Markdown/LaTeX 报告和 JSON 反例证据。
- 启动时把中断任务恢复为可继续的暂停 checkpoint。
- **发现引擎 2.0：** 受验证的数据表示/evaluator DSL、确定性候选证书、Pareto/字典序/加权目标、进化/随机/爬山/beam/退火策略、预算账本、恢复 checkpoint，以及与自主研究阶段的闭环。
- **Formal Proof Search：** 只针对冻结绑定的受限 Lean tactic 搜索；失败/部分状态被保存但绝不当作证明。
- **研究知识与 benchmark：** 归因的跨项目记录、固定 Level 1–4 指标和 `falseVerifiedRate`。

[CHANGELOG](CHANGELOG.md) 只记录真实实现；roadmap 想法不会写成已交付功能。

## 架构

```text
React + TypeScript 渲染进程
        │ 类型化 preload API
Electron 主进程
        ├── SQLite 项目与 checkpoint 存储
        ├── 研究编排器与 Provider 适配层
        ├── 有限构造发现引擎 → 有界 Node worker 线程评估池
        ├── safeStorage 凭据封装
        ├── 隔离 Python worker → SymPy / NumPy / SciPy / Z3
        └── 可审计 Lean 4 / Lake 适配器 → 内核接受
```

渲染进程启用 context isolation、关闭 Node integration、开启 Electron sandbox、拒绝新窗口，并只暴露窄化 preload bridge。详见[架构文档](docs/ARCHITECTURE.md)。

## 支持平台

当前打包应用支持 **64 位 Windows 10/11**，以及 Apple Silicon/Intel 上的 **macOS 13+**。Windows 版本完成了安装包和已安装应用的动态测试；Mac 包在 Windows 上完成了压缩包、架构、原生依赖、权限、符号链接和内容验证，但本次发行没有在实体 Mac 上启动测试。

## 开发环境要求

- Windows 10/11 x64
- Node.js 22 LTS 或更高版本
- npm（随 Node.js 提供）
- 可通过 `python` 调用的 Python 3.12 或更高版本
- 开发与测试所需的 `python/requirements.txt` Python 包
- 可选安装外部 Lean 4/Lake，用于内核检查的形式验证；SageMath 仍只进行能力检测

## 开发者快速开始

```powershell
git clone https://github.com/oneuaena/math-research-agent.git
cd math-research-agent
npm install
python -m pip install -r python\requirements.txt
npm.cmd run dev
```

Windows PowerShell 可能拦截 `npm.ps1`，因此示例使用 `npm.cmd`。这些命令面向源码开发者；普通用户应安装上面的自包含安装包。项目不需要 `.env`：Provider 设置和凭据通过应用界面填写。

新建项目后填写问题和约束，选择“自主研究”或压力测试模式，然后开始运行。本地协调器无需网络凭据，但会刻意把缺少证据的数学结论保留为未验证状态。

## Provider 配置

打开“设置”，选择 **OpenAI-compatible API**，填写：

- **Base URL**：例如 `https://api.deepseek.com`；
- **API Key**：由你合法取得并提供的有效凭据；
- **Model**：你的账号可访问的 chat-completion 模型；
- **Provider HTTP timeout**：它与数学工具超时相互独立。

连接测试会向 `POST /chat/completions` 发送最小非流式请求，并要求收到真实模型响应。不同 Provider 的工具调用、reasoning 字段、结构化 JSON、额度和错误格式可能不同。详见[Provider 文档](docs/PROVIDERS.md)。

绝不要提交凭据。本项目不是任何模型 Provider 的官方客户端；用户需自行遵守访问资格和服务条款。

## 研究流程

```text
猜想 → 形式化 → 规划 → 探索 → 实验 → 模式/引理
    → 证明尝试 → 批判 → 符号/形式检查
    → 综合 → 重规划或 Checkpoint → 继续/完成
```

阶段转换是动态的。已验证反例可能缩短流程；缺少证据或证明缺口可能触发反思和重规划。Checkpoint 保存下一阶段，暂停或重启后不会有意重放已完成的昂贵步骤。

## 工具执行边界

Python worker 使用 `python -I -B -X utf8`、独立项目工作目录、单一 JSON 协议通道、分离捕获的程序 stdout/stderr、输入 schema、AST 白名单、受限内置函数/导入、输出限制和可配置超时。Z3 只针对提交的有界编码报告 `SAT`、`UNSAT` 或 `UNKNOWN`。Lean 适配器调用真实 Lake/Lean，并把精确源文件与内核输出保存在本地审计工件中。

**这是纵深防御，不是完美的操作系统级沙箱。** Python 和原生科学计算包非常复杂。如果进程级突破不可接受，请不要在该机器上执行不可信的模型代码。详见[安全策略](SECURITY.md)。

## 数据与隐私

- 项目、设置、checkpoint、证据、证明尝试和研究历史默认保存在 Electron 用户数据目录；Windows 当前路径为 `%APPDATA%\math-research-agent\research.sqlite3`。
- Windows 安全存储可用时，Provider 凭据通过 Electron `safeStorage` 加密，加密值保存在本地数据库。
- Provider 调用会发送项目问题、目标、背景、已知结果、约束、当前规格、近期步骤、证明/证据上下文和选定来源摘录。
- 导入的 PDF、DOCX、文本、Markdown、LaTeX 会复制到本地用户数据目录，并进行文本提取和分块索引。只有有界检索摘录可能进入 Provider 上下文；原始 PDF/DOCX 二进制不会上传，纯图片 PDF 不执行 OCR。
- 轮转 Provider debug log 会保存状态、schema 信息和已脱敏的模型响应内容。即使凭据模式会被过滤，日志仍可能包含敏感研究文本。

处理机密研究或第三方文档前，请阅读[隐私文档](docs/PRIVACY.md)。

## 构建

生成生产版渲染进程和 Electron bundle：

```powershell
npm.cmd run build
```

准备固定版本的 Windows runtime，并在被忽略的 `release/` 目录中生成自包含 x64 NSIS installer：

```powershell
npm.cmd run dist
```

在 Windows 上交叉组装两个自包含 Mac ZIP：

```powershell
npm.cmd run dist:mac
```

`npm run dist` 会在缓存缺失时校验并下载官方 CPython embeddable ZIP 与固定版本的 Windows wheels。当前 installer 未配置公开可信发布者代码签名证书。安装包应作为 Release 附件发布，不应提交到源码分支。详见[发布流程](docs/RELEASE.md)。

## 测试

公开测试全部使用合成临时数据，不需要真实 API Key：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:formal-tools
npm.cmd run build
npm.cmd run test:e2e
```

执行 `npm.cmd run dist` 后，可以运行安装包冒烟测试：

```powershell
npm.cmd run test:packaged
npm.cmd run test:packaged-runtime
npm.cmd run test:packaged-autonomy
node scripts/validate-macos-asars.mjs
```

Provider E2E 使用本地 mock HTTP server。真实付费 Provider 测试不会进入公开 CI。

## 当前限制

- 源码开发使用开发者配置的 Python；Windows installer 内置 CPython 3.12.10、SymPy、NumPy、SciPy 和 Z3。
- Lean 4/Lake 已是实际外部证明适配器，但不随安装包捆绑；需要形式检查的用户须自行安装或配置路径。SageMath 仍为可选能力检测。
- 导入文档采用本地文本提取和确定性分块检索，不含 OCR、向量嵌入，也不是引用审计级语义搜索系统。
- 受限 Python worker 不是 OS 级沙箱。
- Provider 能力不同；经过有限恢复后，模型输出仍可能格式错误或数学上错误。
- Discovery Engine 是有限、固定目标的搜索底座：它尚不会让 LLM 自主发明构造编码，不会执行任意 evaluator，不是分布式研究集群，也尚未提供跨项目 theorem/lemma 数据库。
- Lean 当前是可审计的内核验证器，不是维护 proof state/策略 beam search 的交互证明搜索器；除非映射经用户确认，Lean theorem 成功仍不同于原自然语言问题的语义等价。
- Windows installer 尚未配置公开代码签名身份；Mac 应用未使用 Developer ID 签名或 Apple 公证。
- 本次 Mac 包完成了静态与结构验证，但没有在实体 Apple Silicon/Intel Mac 上做动态运行测试。

## 研究可复现性

应用会记录实验/工具输入、代码、输出、环境字符串、耗时、证据关联、模型名、token 用量、证明审查和 checkpoint 状态。公开研究结果时：

1. 在实验代码或输入中显式保存随机种子；应用不会自动注入 seed；
2. 记录 Provider/模型、应用版本、预算、假设和搜索范围；
3. 导出见证和可复跑计算；
4. 区分有界计算与全称命题证明；
5. 独立审查每个关键证明步骤。

仓库包含安全的合成示例：[`examples/divisibility-by-30.json`](examples/divisibility-by-30.json)。

## ES(7) 案例状态

应用可以承载长期运行的 Erdős–Szekeres `ES(7)` 探索，但该项目目前仍是**进行中**。计算、已被否定的中间判据、有界搜索和模型论证会作为研究证据保留；它们都不会被表述成公开目标的证明。“继续”会保留已有成果，并从检查点保存的下一阶段推进。

## 参与贡献

提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 安全问题

不要在公开 issue 中提交 API Key、私有研究、漏洞细节或原始 Provider 日志。请遵循 [SECURITY.md](SECURITY.md)。

## 免责声明

本软件是研究工具。模型生成的数学论证可能包含错误。除非相关逻辑命题得到独立论证，否则计算证据不能建立定理。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。第三方组件保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
