# OpenCode 会话存储机制教学文档

> **Agent × LLM 交互机制 与 OpenCode 保存机制 深度剖析**
> 面向学员：希望真正理解"AI 编码助手的一次对话，底层到底发生了什么、数据是怎么存的"的人。
> 方法：真实数据 + 生活类比 + 费曼学习法（每个核心章节末尾都有"费曼一句话"，用大白话重述）。
>
> 本文全部数据来源：作者本机真实数据库 `~/.local/share/opencode/opencode.db`（v1.18.x 实测，非虚构）。

---

## 0. 学员导读

这篇文档回答三个问题：

1. **OpenCode 把对话存到哪里？** —— 一个本地 SQLite 文件，绝不默认上传。
2. **对话在数据库里长什么样？** —— 三级模型（会话→消息→内容片段）+ 一条变更日志。
3. **为什么这么设计？** —— 因为 AI 的"对话"本质是一条流式的、穿插着思考/说话/调工具/改文件的行为流，存储必须跟着这个本质来。

阅读建议：先看第 7 章的"记忆档案馆"图（30 秒建立全局画面），再逐章深入。每章末的"费曼一句话"可以在读完该章后先遮住，自己试着用大白话讲一遍，再对照。

---

## 1. 背景：OpenCode 与它的"记忆"

### 1.1 OpenCode 是什么

一句话：**一个开源的、跑在终端/桌面/IDE 里的 AI 编程助手**（类似 Claude Code、Codex CLI）。它由 Anomaly 公司（原 SST 团队）开发，当前约 19.5 万 GitHub stars。

它的特殊之处：**不锁定任何一家模型厂商**——Claude、GPT、Gemini、DeepSeek 等 75+ 家模型的 API 都能接。底层架构是"agent（代理）"：一个程序循环，负责"看 LLM 说了什么 → 决定调什么工具（读文件/跑命令/搜网页）→ 把结果喂回 LLM → 再决定下一步"，直到任务完成。

### 1.2 一个核心概念：对话 = 行为流，不是文字流

普通聊天软件里，"一条消息"就是一段文字。但 agent 世界里，"一条 AI 回复"是这样一个过程：

```
用户提问
  ↓
AI 思考（想怎么答、要不要调工具）
  ↓
AI 说话（"我先看一下你的项目结构"）
  ↓
AI 调用工具（读文件 / 跑命令 / 搜网页）
  ↓（等工具返回结果）
AI 继续思考 → 继续说话 → 再调工具 → …
  ↓
AI 收尾："完成了！"
```

**这段过程里，思考、说话、工具调用是三种不同类型的内容，且是流式地、交替地产生的。** 这正是理解 OpenCode 存储设计的钥匙——记住它。

### 1.3 全局图景（先混个脸熟）

```
┌────────────────────────────────────────────────────┐
│  ~/.local/share/opencode/opencode.db  (SQLite)      │
│                                                    │
│  ┌─ 内容主线 ──────────────────────────────────┐   │
│  │  session（一次对话）                        │   │
│  │    └─ message（一句话）                    │   │
│  │         └─ part（这句话的细节：想/说/做）  │   │
│  └───────────────────────────────────────────┘   │
│  ┌─ 变更日志 ──────────────────────────────────┐   │
│  │  event（每次写入都录像，可回放）             │   │
│  └───────────────────────────────────────────┘   │
│  ┌─ 辅助 ─────────────────────────────────────┐   │
│  │  todo(待办) / share(分享) / credential(凭证)│   │
│  └───────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

> **费曼一句话**：OpenCode 的记忆就是一本"带监控录像的会话档案"。对话内容按"谁→说了什么→细节"分三层存放，旁边有一台录像机把每一次改动都录下来，所以随时能倒带回放。

---

## 2. 存储在哪里（真实路径）

### 2.1 数据库位置

| 平台 | 路径 |
|---|---|
| macOS / Linux（实测） | `~/.local/share/opencode/opencode.db` |
| Windows | `%USERPROFILE%\.local\share\opencode\opencode.db` |
| 官方查询命令 | `opencode db path` |

作者本机的真实情况：**328MB 的 SQLite 文件**，里面装着 187 个会话、5,221 条消息、23,205 个内容片段、75,349 条变更事件。

### 2.2 数据目录里还有什么

```
~/.local/share/opencode/
├── opencode.db          ← 主数据库（所有对话内容）
├── opencode.db-wal      ← SQLite 预写日志（崩溃恢复用）
├── auth.json            ← 登录凭证（密钥类，绝不外传）
├── log/                 ← 运行日志
├── snapshot/            ← 文件快照（改文件前的备份，/undo 用）
├── tool-output/         ← 工具输出缓存
├── storage/             ← 各插件的独立小 JSON（agent 使用提醒等）
└── repos/               ← 仓库缓存
```

> **费曼一句话**：所有记忆都在你电脑上的一个文件里（一个数据库）。没人偷看你的对话——除非你自己点"分享"。改文件前系统还会先拍一张"快照"存档，后悔了可以还原。

---

## 3. 核心数据模型：session → message → part（三级内容模型）

### 3.1 三级的角色（类比：档案册 → 记录条 → 内容页）

| 级别 | 真实表 | 类比 | 回答的问题 |
|---|---|---|---|
| session | `session` | 一册档案（一次对话） | "这是哪次对话？谁？用什么模型？花了多少钱？" |
| message | `message` | 一条记录（一句话） | "这句话是谁说的？（用户 / AI）什么时候？" |
| part | `part` | 一张内容页（细节） | "这句话具体说了啥、心里想了啥、调了啥工具、改了啥文件？" |

### 3.2 完整表结构（关键列）

**session 表**（一次对话一行）：

```
id               PK  会话唯一 id（如 ses_ff56d997…）
project_id       FK  属于哪个项目
parent_id        FK  父会话 id（子 agent 会话用；主会话为空）
slug                 人类短名（如 stellar-lagoon）
directory            工作目录
title                对话标题（AI 自动总结）
version              opencode 版本
agent                哪个 agent（build/plan/consultant…）
model                用的什么模型
cost / tokens_*      整个会话的成本与 token 统计（聚合账本）
time_created/updated 创建/最后更新时间
```

**message 表**（一句话一行）：

```
id            PK  消息 id（如 msg_00a926698001…）
session_id    FK  属于哪个会话
data              JSON 元数据：
                  {"role":"user"/"assistant", "agent":…, "model":…,
                   "parentID":…, "finish":…, "tokens":…, "cost":…}
```

**part 表**（一句话的细节，一行一个）：

```
id            PK  内容片段 id（如 prt_00a927396001…）
message_id    FK  属于哪条消息
session_id    冗余列（复制会话 id，加速查询，无外键）
data              JSON 内容，按 type 区分（7 种类型，见第 4 章）
```

### 3.3 真实实例：一个真实会话的全貌

作者本机真实会话（"上海开市客值得买什么推荐"，2026-08-16，8 分钟）：

```
session: ses_ff56d997effeEDZIskrjQ2esWR
  agent=consultant  model=deepseek-v4-pro  version=1.18.14
  cost=0.021 美元  tokens_input=24,798  tokens_output=4,250
  title="上海开市客值得购买产品推荐"

12 条 message（3 条用户 + 9 条 AI）
43 个 part（思考/说话/工具调用/步骤标记）
132 条 event（变更录像）
```

> **费曼一句话**：一次对话是一册档案，里面贴着 12 张"谁说了什么"的便签（message），每张便签背面是若干张细节页（part）——有的写心里话（思考）、有的写正式话（正文）、有的贴工具小票（工具调用）。8 分钟对话 = 43 张细节页。

---

## 4. part 的拆分艺术：为什么一条消息要拆成多个 part？

### 4.1 设计理由（7 条）

LLM 的回复不是一次性成文的，而是一条**类型不断切换的流**。拆成 part 是必然选择：

| # | 理由 | 收益 |
|---|---|---|
| 1 | 流式传输 | AI 边想边写边调工具，写一个 part 存一个，不用等全部完成 |
| 2 | 类型化渲染 | 思考可折叠、工具显示成卡片、正文正常排版 |
| 3 | 增量同步 | 多端（终端/桌面/网页）只同步新增的 part，不用重传整条消息 |
| 4 | 部分完成可恢复 | 思考写一半崩溃？只有这个 part 是半截的，好识别、好丢弃 |
| 5 | 选择性加载 | 组装上下文时可以不加载思考过程，省 token |
| 6 | 状态机落地 | 工具调用有 running→completed 状态；步骤有开始/结束标记 |
| 7 | 审计粒度 | 每个"想什么/说什么/做什么"是独立单元，可单独检索、回放 |

### 4.2 划分规则（一句话 + 细则）

> **按内容类型划分：LLM 每产出一种类型的内容就新建一个 part；同类型连续输出合并进同一个 part（流式追加）；类型切换 = 新 part。**

part 的 7 种类型：

| type | 存什么 | 何时创建 |
|---|---|---|
| `text` | AI 输出的正式文字 / 用户提问 | 每次开口说话 |
| `reasoning` | AI 的思考过程 | 每次开始思考 |
| `tool` | 一次工具调用的完整记录（调用名+参数+结果） | 每次调用工具 |
| `step-start` | 一步执行的开始（带文件快照哈希） | 每执行一步 |
| `step-finish` | 一步执行的结束（含 token/成本记账） | 每结束一步 |
| `patch` | 一次文件改动（改前快照哈希 + 文件列表） | 每次改文件 |
| `compaction` | 上下文压缩标记 | 长对话被压缩时 |

### 4.3 真实时间线：第一条 AI 消息的"解剖"

真实消息 `msg_00a9266ab001…`（AI 回答"推荐上海开市客值得买的产品"），被拆成 **7 个 part**，历时 **11.1 秒**。下面是数据库毫秒级记录与 LLM 真实行为的对照：

```
时刻                LLM 在干什么（真实内容）              part 动作      事件序号
──────────────────────────────────────────────────────────────────────────────
20:36:01.8  消息开始                                    message 创建    seq 4
20:36:03.6  AI 开始执行"第一步"                        新建 step-start  seq 7
20:36:05.1  AI 开始思考                                新建 reasoning  seq 8
            "The user is asking for recommendations         (先写264字符)
             on Costco (开市客) Shanghai…"
20:36:05→12 思考持续输出 7.1 秒                         同 part 更新    seq 9
            "…Let me check skills. The consultation        (长到3220字符)
             skill applies here…"
20:36:12.3  思考完毕，说出第一句话                      新建 text       seq 10
            "I'll load the consultation workflow first…"
20:36:12.6  调用工具① skill（加载咨询技能）              新建 tool       seq 11-13
20:36:12.8  调用工具② memory_recall（查记忆）            新建 tool       seq 14-16
20:36:13.4  调用工具③ tavily 搜索                       新建 tool       seq 17-20
20:36:14.9  收尾（还要继续干活）                        新建 step-finish seq 21
            reason:"tool-calls"
```

数据库里的最终形态（7 个 part 按创建顺序）：

```
message: msg_00a9266ab001… (role=assistant, finish="tool-calls")
  ├─ part ① step-start  {snapshot:"e8a67da4…"}
  ├─ part ② reasoning   {text:"The user is asking…(3220字符)"}
  ├─ part ③ text        {text:"I'll load the consultation workflow first…"}
  ├─ part ④ tool-skill  {tool:"skill", callID:"call_00_…", input:{name:"consultation"},
  │                      output:"## Skill: consultation…(6794字符)"}
  ├─ part ⑤ tool-memory {tool:"consultation-memory_memory_recall", callID:"call_01_…"}
  ├─ part ⑥ tool-tavily {tool:"tavily_tavily_search", callID:"call_02_…",
  │                      output:"{error:432 搜索超限}"}   ← 失败也完整保存！
  └─ part ⑦ step-finish {reason:"tool-calls", tokens:{total:43675,…}, cost:0.0043}
```

**这个例子揭示了四个真相：**

1. **part 的创建顺序 = LLM 的产出顺序**（先想、后说、再调工具），时间戳就是 AI 行为的"心电图"。
2. **同一个 part 可以多次更新**：思考从 264 字符长到 3220 字符；工具调用从 running 变 completed。每次更新产生一条新事件。
3. **失败的调用也被如实记录**：tavily 搜索报 432 错误的完整 JSON 就存在 part 里——记忆不粉饰。
4. **三层粒度各司其职**：part 是原子（内容单元）、step 是执行单位（step-start/finish 的括号内算一步）、message 是对话单位。

> **费曼一句话**：把一次 AI 回复拆成多个 part，就像把一段"现场直播"拆成一帧帧画面——每帧标注了类型（这是思考、这是说的话、这是工具操作）和时间。好处是：可以边播边存、可以只重看某类画面、崩了只丢半帧、事后能逐帧回放。

---

## 5. 事件日志：event 表（监控录像）

### 5.1 结构与角色

除了内容表，OpenCode 还维护一张"变更日志"：

```
event_sequence（每个会话一行，记录当前事件序号）
  aggregate_id = 会话 id | seq = 当前序号
      │
      ▼ (aggregate_id 外键)
event（每次写入追加一条）
  id | aggregate_id | seq(递增) | type | data(JSON, 完整快照)
```

只有 4 种事件类型：`session.created.1`、`session.updated.1`、`message.updated.1`、`message.part.updated.1`（带版本后缀）。

真实事件序列（开市客会话开头）：

```
seq 0  session.created.1        会话诞生
seq 1  message.updated.1        用户消息写入
seq 2  message.part.updated.1   用户文本 part 写入
seq 3  session.updated.1        会话元数据更新
seq 4  message.updated.1        AI 消息开始
…（之后每次 part 的创建/更新都追加一条）
```

### 5.2 回放：如何"倒带"整个会话

**回放 = 按 seq 顺序，把每条事件里的完整快照依次应用**（后者覆盖前者），最终状态与内容表一致。真实例子——同一个思考 part 的两条事件：

```
seq 8  data.part.text = "The user is aski…"           ← 264字符（思考到一半）
seq 9  data.part.text = "The user is asking for…完整"  ← 3220字符（思考完成）
       应用顺序 = 先出现半截，再被完整版覆盖 → 最终 = 完整版 ✅
```

这正是多端同步的原理：桌面/网页/TUI 消费事件流即可实时渲染，无需直接读内容表。

### 5.3 冗余问题：是不是很浪费？

**是，冗余真实存在且量级不小**（全库实测）：

| 位置 | 大小 |
|---|---|
| part 内容（最终版） | 72.5 MB |
| message 元数据 | 4.0 MB |
| event 日志（含内嵌快照） | **159.9 MB** |

同一份 part 内容平均存了 2.4 份。但这是**明码标价的取舍**：用存储复制换取"零 JOIN 的自包含同步 + 不可变的审计历史"。事件是短期消费的日志，历史部分理论上可裁剪。对个人电脑一个 328MB 的 SQLite 来说，这笔交易很划算。

### 5.4 查询性能：会不会很慢？

不会。`aggregate_id` 是**独立列**（不是藏在 JSON 里），配了复合索引 `(aggregate_id, seq)`。实测：7.5 万行全表，查单会话 132 条事件 **仅 6 毫秒**。设计原则：**要过滤/排序的字段提升为列，不参与查询的复杂内容留在 JSON**。

> **费曼一句话**：event 表是一台监控录像机，内容表是档案柜。每次有人动档案（写/改/补），录像机就录一条，还附一张"当时的完整快照"。想重放？按录像带序号（seq）一格格放就行。代价是录像带占地方（比档案本身还大），换来的是"任何时刻都能完整回放"。档案（内容表）是"现在长这样"，录像（event）是"怎么一步步变成这样的"。

---

## 6. 完整关联关系总图（20 张表）

### 6.1 ASCII 全图（含全部外键/冗余/逻辑关联）

```
═══════════ 账号/凭证簇（与主线无外键） ═══════════
  account (id PK) ────< account_state (active_account_id FK → account.id)
  control_account (email+url 复合PK)      [独立]
  credential (id PK)                       [独立]

═══════════ 系统表（独立） ═══════════
  migration (id PK)        data_migration (name PK)

═══════════ 项目层 ═══════════
  project (id PK) ──< workspace          (project_id FK)
                  ──< project_directory  (project_id FK, 复合PK)
                  ──< permission         (project_id FK)

═══════════ 内容主线 + 状态 + 日志 ═══════════

┌──────────────────────────────┐
│          project             │
│  id (PK)                     │
└───────────────┬──────────────┘
                │ project_id (FK)
                ▼
┌──────────────────────────────┐
│          session             │
│  id (PK) ◄───────────────────┼─────────┐
│  project_id (FK)             │         │  ← parent_id (FK, 自引用)
│  parent_id (FK) ─────────────┼──► session.id（子会话树）
│  …(cost/tokens 聚合账本)      │         │
└──┬──────────┬──────────┬─────┘         │
   │          │          │               │
   │session_id│          │session_id     │
   │(FK)      │          │(FK)           │
   ▼          ▼          ▼               │
┌────────┐ ┌────────┐ ┌────────────────┐ │
│ message│ │  todo  │ │ session_share/ │ │
│ id (PK)│ │session_│ │ session_context│ │
│session_│ │id+pos  │ │ _epoch/        │ │
│id (FK) │ │ 复合PK  │ │ session_input/ │ │
│ data   │ │        │ │ session_message│ │
└───┬────┘ └────────┘ │ (均 session_id │ │
    │ message_id (FK) │  FK)           │ │
    ▼                 └────────────────┘ │
┌──────────────────────────────┐         │
│            part              │         │
│  id (PK)                     │         │
│  message_id (FK)             │         │
│  session_id (冗余,无FK) ──────┼─────────┘  ← 免JOIN捷径
│  data (7种类型)               │
└──────────────────────────────┘

  event_sequence (aggregate_id PK) ◄── 逻辑等同 session.id（值相等,无FK约束）
       │ aggregate_id (FK, 级联删除)
       ▼
  event (id PK, aggregate_id FK, seq, type, data JSON)
       │  data.info.id ───────► message.id   (JSON内嵌,无FK)
       │  data.part.id ───────► part.id      (JSON内嵌,无FK)
       │  data.part.messageID ► message.id   (JSON内嵌,无FK)
```

### 6.2 图例

| 标记 | 含义 |
|---|---|
| `──►` + `(FK)` | 外键约束（强关联，含级联删除） |
| `(PK+FK)` | 既是主键又是外键（1:1 关联表） |
| `(冗余,无FK)` | 冗余列：复制值，无约束，免 JOIN 捷径 |
| `(逻辑等同)` | 值相等但无数据库约束（应用层约定） |
| `data.xxx.id ──►` | JSON 内嵌对应（无外键，靠序列化 id） |
| `(自引用)` | 表指向自己（子会话树） |
| `(复合PK)` | 联合主键 |
| `(聚合账本)` | 由子表累加写入的统计冗余 |

**三条链，记住就通关：**
1. **外键链**：`session → message → part`（内容归属，强约束）
2. **逻辑链**：`event_sequence.aggregate_id = session.id`（值相等，无约束）
3. **JSON 链**：`event.data.part.id → part.id`（内嵌快照，无外键）

---

## 7. 感性全景：把数据库想成一座「记忆档案馆」

> 读完这张图，你就能用自己的话向任何人解释 OpenCode 的记忆机制。

```
┌──────────────────────────────────────────────────────────────────┐
│              🏛️  OpenCode 记忆档案馆（本地，不上云）               │
│                                                                  │
│  ┌─ 📦 档案柜 project ────────────────────────────────────────┐  │
│  │   一个项目 = 一个档案柜（按目录建档）                         │  │
│  │                                                            │  │
│  │   ├─ 🗂️ 档案册 session ── 一次对话 = 一册档案 ──────────┐  │  │
│  │   │   封面：标题/是谁(agent)/什么模型/花了多少钱           │  │  │
│  │   │                                                      │  │  │
│  │   │   ├─ 📄 记录条 message ── 谁说了一句话                │  │  │
│  │   │   │     └─ 📑 内容页 part ── 这句话的细节：           │  │  │
│  │   │   │          · 说了什么(text)                        │  │  │
│  │   │   │          · 心里怎么想(reasoning)                 │  │  │
│  │   │   │          · 调了什么工具(tool)                    │  │  │
│  │   │   │          · 改了哪个文件(patch)                   │  │  │
│  │   │   │          · 走到哪一步(step-start/finish)         │  │  │
│  │   │   │          · 何时压缩过(compaction)                │  │  │
│  │   │   │                                                  │  │  │
│  │   │   ├─ 📝 便签 todo ── 待办清单（夹在档案里，重启还在） │  │  │
│  │   │   ├─ 🔗 分享码 session_share ── 复印出去发链接        │  │  │
│  │   │   └─ ⏱️ 压缩纪元 epoch ── "本册已压缩到第N页"        │  │  │
│  │   │                                                      │  │  │
│  │   └─ 🗂️ 子档案册 session ── 子 agent 的档案              │  │  │
│  │        （封面写 parent_id = 引用父档案，独立成册）         │  │  │
│  │                                                            │  │  │
│  │   📁 附属：workspace(远程分馆) project_directory(多目录)    │  │  │
│  │        permission(批准的权限批条)                          │  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 📹 监控室 event + event_sequence ────────────────────────┐  │
│  │   每次往档案里写/改/补一笔，监控就录一条（带完整快照）       │  │
│  │   seq = 录像带序号；按顺序回放 = 重演整个会话               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 🔐 门卫室 account / credential ─────────────────────────┐  │
│  │   谁(账号) + 拿什么钥匙(凭证) 进门 —— 与档案内容无关        │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

> **费曼一句话**：OpenCode 的记忆 = 一册册"档案"（session），里面是排好序的"记录条"（message），每条记录下贴着写满细节的"内容页"（part）；旁边有便签（todo）、分享码（share）；而监控室（event）把每次翻动都录了像，随时能倒带。

---

## 8. 完整会话走查：从创建到结束（真实对话 + 每步落库）

以真实会话（上海开市客推荐）为剧本，走一遍"对话发生时，数据库每一步在做什么"。

### 阶段 1：会话创建 + 用户提问（20:36:01）

**LLM 交互**：用户输入"推荐一下 上海的开市客 值得购买的产品（质量，性价比等），并给出推荐的理由"

**落库**：`session` 新增 1 行 + `message` 新增 1 行（user）+ `part` 新增 1 行（text 类型，内容=用户原话）。此时 title 还是空的（后面 AI 总结时补）。

### 阶段 2：AI 第一轮（20:36:01–20:36:15，约 13 秒）

**LLM 交互**：AI 思考 → 说话 → 连调 3 个工具（skill 加载 / 查记忆 / 网页搜索，其中搜索超限失败）→ 暂停（等工具结果）

**落库**：`message` +1（assistant）、`part` +7（见第 4.3 节完整解剖）。失败的搜索也完整保存。消息收尾时补 `finish:"tool-calls"`、`cost`、`tokens`。

### 阶段 3：AI 第二轮与结论（20:36:15–20:36:21）

**LLM 交互**：换用备用搜索工具再搜 → 写出 1500 字完整推荐结论（含价格表、风险、替代方案、证据可信度）→ 正常收尾

**落库**：`message` +2（同轮续写）、`part` +9。最后一条消息的 step-finish 的 `reason:"stop"`——**"stop" = 这轮正常说完了**（对比阶段 2 的 "tool-calls" = 被打断待续）。

### 阶段 4：用户追问 + 压缩（20:41–20:44）

**LLM 交互**：用户补充"4~5 人家庭…" → AI 收敛推荐；用户问"有什么经验可以沉淀" → AI 连调 4 次工具（含 3 次参数修正）→ 输出"记忆预览"等确认

**落库**：`message` +8、`part` +26。期间若触发上下文压缩，会新增 `compaction` part + 摘要消息（原始数据不删，只退出上下文）。

### 阶段 5：如果用户说"撤销/分享"

- **/undo**：`session.revert` 记录快照哈希 → 从 `snapshot/` 目录还原文件 → **历史记录不动**（数据库只追加，不修改）。
- **/share**：`session_share` 新增一行（含分享 URL 和 secret）→ 这份对话被上传到 opencode.ai 分享服务。**这是唯一让数据离开本地的路径，且必须显式触发。**

### 走查总结：这个真实会话的最终形态

```
8 分钟对话 → session 1 行 + message 12 行 + part 43 行 + event 132 行
  → 3 次用户发言 = 3 条对话链（user 消息是链起点）
  → 9 条 AI 消息 = 流式续写的产物（finish 标记状态）
  → 8 次工具调用全部留痕（含 1 次失败、3 次参数修正）
```

---

## 9. LLM × Agent 交互机制的教学要点（学员重点）

结合前面的真实数据，提炼 agent 与 LLM 交互的核心机制：

### 9.1 流式与增量（边生成边保存）

LLM 是流式输出的。数据库设计"跟随"这个特性：**part 级追加 + 事件级通知**。你看到的"AI 打字效果"，本质是前端不断收到 `message.part.updated.1` 事件并刷新渲染。

### 9.2 工具调用循环（agent 的"手脚"）

```
LLM 说"我要调工具" (finish:"tool-calls")
  → agent 执行工具
  → 结果作为新 part 存库 (tool part, input+output)
  → 结果喂回 LLM → LLM 继续
```
工具调用是 agent 区别于纯聊天机器人的核心。**每次调用（含失败）都有完整记录**——这是 agent 可审计、可回放、可调试的基础。

### 9.3 中断与恢复（一切皆可续写）

- 消息未说完 → `finish:"tool-calls"`，下一条消息继续（追加，不修改历史）
- 进程崩溃 → 状态全在磁盘（SQLite + 快照 + todo），重启即恢复；只丢"正在流式生成的那半句话"
- todo 是独立表 → 任务清单跨重启存活

### 9.4 子 agent（分形记忆）

subagent 不是嵌套对象，而是**独立的完整会话**（自己的 session/message/part/event），通过 `parent_id` 指向父会话。好处：上下文隔离（主会话只存任务+结果摘要）、独立核算（子会话可用更便宜的模型）、独立恢复。恢复时顺着 parent_id 能重建整棵"会话树"。

### 9.5 成本核算（两级记账）

每个 step-finish 记录本步 token 明细（含缓存命中）→ 累加到 session 行。**明细到步、汇总到会话**，随时知道"这次对话花了多少钱、缓存省了多少钱"。

### 9.6 快照与撤销（后悔药）

改文件前自动拍快照（`snapshot/` 目录，哈希寻址）；`/undo` = 拿哈希取快照还原文件，历史记录保持不可变。**可以反复撤销**，每次都有锚点。

### 9.7 压缩（长对话管理）

上下文超限时自动压缩：`compaction` part 记录截断点 + 生成摘要消息。原始数据不删除（可回溯），只是不再注入模型上下文。

### 9.8 隐私边界

默认全部本地存储；唯一外传路径是显式 `/share`（带随机 secret 的分享链接）。企业版（Enterprise）可配 SSO + 内部网关，保证代码数据不出内网。

---

## 10. 费曼自测：你能用大白话讲清楚吗？

> 费曼学习法的精髓：**如果你不能简单地解释它，就说明你还没真正理解它。** 学完本文，请尝试回答（遮住答案先自测）：

**Q1. OpenCode 把对话存在哪里？默认会传到云端吗？**
A：存在本地 SQLite（`~/.local/share/opencode/opencode.db`）。默认不传，只有显式 /share 才上传。

**Q2. 一条 AI 消息在数据库里是什么？**
A：一条 message 行（元数据：谁/什么时候/花多少钱）+ 若干 part 行（内容：思考、正文、工具调用、步骤标记等），按产出顺序排列。

**Q3. 为什么一条消息要拆成多个 part？举一个真实例子。**
A：因为 AI 回复是流式的、类型交替的（想→说→调工具）。真实例子：开市客会话第一条 AI 消息拆成 7 个 part（step-start / reasoning / text / 3×tool / step-finish），历时 11 秒。

**Q4. event 表是什么？和内容表什么关系？**
A：变更日志（监控录像）。每次写入追加一条，data 里内嵌完整快照。与内容表无外键，靠 JSON 里的 id 对应。回放 = 按 seq 应用快照。

**Q5. 冗余那么严重，是不是设计缺陷？**
A：不是。这是"快照式事件日志"的标准取舍：用存储换自包含、可回放、免 JOIN。历史事件可裁剪。

**Q6. 给一个 12 岁孩子讲：OpenCode 怎么记住我们的对话？**
A（参考）：它有一本笔记本（数据库）和一台录像机（event 表）。你每说一句话，它就记一张便签（message），便签后面贴着"心里话、正式话、工具小票"（part）。它干活前还给文件拍快照（snapshot），后悔了能还原。它做什么都录像，所以中断了、换电脑界面了，都能接着看。所有笔记都放在你的电脑里，不告诉别人。

---

## 11. 附录

### 11.1 动手验证的 SQL（在你自己机器上跑）

```bash
# 1. 看数据库在哪
opencode db path

# 2. 最近 10 个会话
sqlite3 "$(opencode db path)" "select substr(id,1,20), title, agent, cost, time_created from session order by time_updated desc limit 10"

# 3. 看某会话的消息时间线
sqlite3 "$(opencode db path)" "select datetime(time_created/1000,'unixepoch','localtime'), json_extract(data,'$.role') from message where session_id='<会话id>' order by time_created"

# 4. 提取某会话所有工具调用（类型化检索的威力）
sqlite3 "$(opencode db path)" "select json_extract(data,'$.tool') from part where session_id='<会话id>' and json_extract(data,'$.type')='tool'"

# 5. 看子会话树
sqlite3 "$(opencode db path)" "select id, parent_id, agent from session where parent_id is not null limit 10"

# 6. 按会话排成本
sqlite3 "$(opencode db path)" "select title, cost from session order by cost desc limit 10"
```

### 11.2 20 张表速查（全列见正文各章）

| 分组 | 表 |
|---|---|
| 内容主线 | project, session, message, part |
| 日志层 | event, event_sequence |
| 会话附属 | todo, session_share, session_context_epoch, session_input, session_message |
| 项目层 | workspace, project_directory, permission |
| 账号凭证 | account, account_state, control_account, credential |
| 系统 | migration, data_migration |

### 11.3 三个"特殊关联"（最容易忘）

1. `part.session_id` = **冗余列**（免 JOIN 捷径，值由应用保证一致，无外键）
2. `event_sequence.aggregate_id` = **逻辑等同** session.id（无约束，靠约定）
3. `event.data` 内嵌 message/part 对象 = **JSON 快照对应**（自包含，无外键）

---

*本文基于 opencode v1.18.x 真实数据库实证整理。数据为作者本机快照，字段可能随版本演进（schema 迁移由 migration 表记录，38 次）。*
