# Math Research Agent

[English](README.md) | [简体中文](README.zh-CN.md)

**一个面向实验数学与猜想探索、强调可复现和可审计的自主研究工作台。**

Math Research Agent 是一款本地优先的 Electron 桌面应用，用于组织模型辅助的数学探索。它把持久化研究树、结构化实验、证明尝试、怀疑性审查、证据等级、预算和 checkpoint/resume 放在同一个桌面工作空间中。

本项目是独立开源项目。OpenAI-compatible API、DeepSeek、OpenAI、Anthropic、Microsoft、Lean、SageMath 或大学名称仅用于事实性的兼容说明，不代表隶属、授权或背书。

## 下载

### Windows 10/11 x64

- **[安装包（.exe）](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-Setup-1.2.0.exe)** — SHA-256 `4712516FF2FD330BFDA815E6E575CFCD41EE309059B11832236EF98E2362D74B`
- **[免安装软件 ZIP](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-Windows-Software.zip)** — SHA-256 `D59C198D980BF0ECC20A51A078CF6D151EEBD436A6171B2EC2039ED85744F5FF`

### macOS 13 或更高版本

- **[Apple Silicon（M1/M2/M3/M4/M5）](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-mac-arm64.zip)** — SHA-256 `E47B4939843B2F8297A70804D903536E5B731AAB96A356AAE71E7BE406640EC4`
- **[Intel Mac](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-mac-x64.zip)** — SHA-256 `97EA797D41E47750938D5FEF87D58B15BE8FF131F26F70870BFF553C50AE4BE1`

Windows 用户运行安装包或解压免安装 ZIP；Mac 用户解压后把应用拖入“应用程序”目录再打开。启动后进入“设置”，填写自己的 Provider、Base URL、模型和 API Key，并运行“运行环境检查”。

安装包已经内置 Python 3.12、SymPy、NumPy、SciPy 和 Z3。普通用户**不需要**安装 Node.js/Python，不需要执行 `npm install`、`pip install`，不需要修改 PATH；默认按当前用户安装，也不需要管理员权限。

由于独立开源发行版没有商业代码签名证书，Windows SmartScreen 可能显示“Unknown publisher / 未知发布者”。Mac 应用同样未签名、未公证，首次启动可能需要按住 Control 点击应用并选择“打开”。请核对公开的 SHA-256，不要全局关闭系统安全功能。

## 项目概览

应用目前可以：

- 把自然语言问题转换为经过 schema 校验的结构化规格；
- 使用不同研究角色运行有界、持久化的自主研究流程；
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
| `FORMALLY VERIFIED` | Lean 内核接受了所提交定理，并且应用把它关联到目标完全匹配且经过独立审查的证明。 |
| `LLM ASSESSED ONLY` | 只有模型判断，没有独立机器或形式化证据。 |

只要关键步骤无效、未解决、需要缺失引理，或缺少必要计算/形式化，候选证明就仍是不确定的。详见[数学验证规范](docs/VERIFICATION.md)。

## 已实现功能

- 中文默认界面，可切换英文。
- 形式化、规划、探索、实验、模式发现、引理生成、证明尝试、批判、验证、综合、重规划和 checkpoint 等自主阶段。
- 可配置迭代次数、总时长、分支数、工具超时、Provider 超时和 checkpoint 间隔。
- 类型化研究节点、图边、证据记录、证明文档和逐步审查状态。
- 使用内置合成示例进行可复现、精确的反例压力测试。
- 项目研究对话支持明确的研究控制路由，并从已导入文档检索有界上下文。
- 本地文档提取与分块索引，以及可选的 arXiv/Crossref 文献检索。
- Python、SymPy、Z3、Lean 工具运行保留精确输入、分离的输出/错误、超时和严格证据等级审计。
- OpenAI-compatible `/chat/completions` 传输层，支持有限重试、SSE 归一化、工具调用、reasoning 字段兼容和结构化 JSON 恢复。
- 本地导出 Markdown/LaTeX 报告和 JSON 反例证据。
- 启动时把中断任务恢复为可继续的暂停 checkpoint。

[CHANGELOG](CHANGELOG.md) 只记录真实实现；roadmap 想法不会写成已交付功能。

## 架构

```text
React + TypeScript 渲染进程
        │ 类型化 preload API
Electron 主进程
        ├── SQLite 项目与 checkpoint 存储
        ├── 研究编排器与 Provider 适配层
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
