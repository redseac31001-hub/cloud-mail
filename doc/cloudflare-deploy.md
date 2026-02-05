# Cloud Mail Cloudflare 部署与配置指南（逐步）

本指南面向 **直接在 Cloudflare 部署并可用收件/转发** 的场景，包含：资源创建、Worker 绑定、变量配置、初始化、Email Routing 配置、邮箱级转发配置与常见报错排查。

相关功能文档：
- 邮箱级转发（每个邮箱单独指定目标邮箱）：`doc/mailbox-forwarding.md`

---

## 0. 你需要准备什么

- 一个已接入 Cloudflare 的域名（DNS 托管在 Cloudflare）
- 已开通 Cloudflare **Email Routing**（域名侧）
- 一个 Cloudflare Workers 项目（脚本名建议用 `cloud-mail`，与默认 `wrangler.toml` 一致）

> 说明：Cloud Mail 运行需要 **D1（数据库）+ KV（缓存/对象存储兜底）**；附件存储建议再绑定 **R2**（可选但推荐）。

---

## 1. 创建 Cloudflare 资源（控制台路径）

### 1.1 创建 D1 数据库

1) Cloudflare 控制台 → **Workers & Pages** → **D1** → **Create database**
2) 记下：
- `database_name`（例如：`cloud-mail`）
- `database_id`（一串 UUID）

Worker 绑定要求：
- 绑定名必须是：`db`

---

### 1.2 创建 KV 命名空间

1) Cloudflare 控制台 → **Workers & Pages** → **KV** → **Create namespace**
2) 记下：
- `namespace_id`

Worker 绑定要求：
- 绑定名必须是：`kv`

重要避坑（非常常见）：
- 不要在 Worker 的 **Variables/Secrets** 里再创建一个叫 `kv` 的变量/密钥  
  否则会把 KV 绑定覆盖成字符串，触发：`env.kv.put is not a function` / `env.kv.get is not a function`

---

### 1.3 （推荐）创建 R2 Bucket（用于附件/图片）

1) Cloudflare 控制台 → **R2** → **Create bucket**
2) 记下：
- `bucket_name`

Worker 绑定要求：
- 绑定名必须是：`r2`

> 不绑定 R2 也能跑，但附件/图片会退化存 KV（容量/性能不如 R2）。

---

## 2. 部署 Worker（两种方式）

### 2.1 方式 A：本地 `wrangler deploy`（推荐）

文件位置：
- Worker：`cloud-mail/mail-worker`
- 配置：`cloud-mail/mail-worker/wrangler.toml`

1) 打开 `cloud-mail/mail-worker/wrangler.toml`，取消注释并填写资源绑定：

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "<你的 D1_DATABASE_ID>"

[[kv_namespaces]]
binding = "kv"
id = "<你的 KV_NAMESPACE_ID>"

[[r2_buckets]]
binding = "r2"
bucket_name = "<你的 R2_BUCKET_NAME>"

[vars]
domain = ["example.com"]
admin = "admin@example.com"
jwt_secret = "change-me-to-a-long-random-string"
```

2) 部署（会自动构建前端并作为静态资源部署）

```bash
cd cloud-mail/mail-worker
pnpm install
pnpm wrangler deploy
```

> `wrangler.toml` 已配置 `[assets]` 与 `[build]`，会执行 `mail-vue` 的 build 并把产物放到 `mail-worker/dist`。

---

### 2.2 方式 B：Cloudflare 控制台（Git/手动）

如果你使用 Workers 的 Git 集成或控制台构建：

1) 确保构建环境可用 `pnpm`
2) Worker 项目目录使用 `cloud-mail/mail-worker`
3) 在 Worker 设置里绑定：
- D1：绑定名 `db`
- KV：绑定名 `kv`
- R2（可选）：绑定名 `r2`
4) 在 Worker 设置里添加变量（Variables/Secrets）：
- `domain`：必须是 JSON 数组字符串，例如：`["example.com"]`（不要填 `example.com`）
- `admin`：管理员邮箱，例如：`admin@example.com`
- `jwt_secret`：任意长随机字符串

---

## 3. 初始化（必须做）

部署完成后，访问初始化接口（会创建/补齐表结构，并把 setting 缓存写入 KV）：

- 路径：`GET /api/init/:secret`
- `:secret` 等于你配置的 `jwt_secret`

示例：
- `https://<你的域名>/api/init/<jwt_secret>`

返回 `success` 即初始化完成。

常见报错：
- `KV数据库未绑定或被同名变量覆盖`：检查 KV 绑定名是否为 `kv`，并删除同名变量/密钥 `kv`
- `D1数据库未绑定...`：检查 D1 绑定名是否为 `db`

---

## 4. 配置 Email Routing（收件 → Worker）

1) Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2) 按提示完成 Email Routing 启用（包含 MX 记录等）
3) 创建 Routing rule（推荐 Catch-all）：
- 匹配：`*@example.com`
- 动作：**Send to a Worker**
- 选择：`cloud-mail`（确保是你部署的同一个 Worker/环境）

> 如果路由到了错误的 Worker（或错误环境），会出现“HTTP 正常但收件失败”的情况。

---

## 5. 配置邮箱级转发（按邮箱指定目标邮箱）

### 5.1 Cloudflare 侧：验证目标邮箱（必须）

Cloudflare **验证的是具体的目标邮箱地址**（Destination address），不是域名。

路径：
- Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing** → **Destination addresses**

把你要转发到的目标邮箱逐个添加并完成验证（会发验证邮件）。

未验证会导致：Worker 调用 `message.forward()` 失败（转发不生效）。

---

### 5.2 Cloud Mail 侧：开启外部转发总开关

邮箱级转发受系统级开关控制：

1) 登录 Cloud Mail 管理后台
2) 进入：**系统设置** → **邮件推送** → **第三方邮箱**
3) 打开开关（启用）
4) 系统级 `forwardEmail` 可留空（只用邮箱级转发也可以）

---

### 5.3 Cloud Mail 侧：给某个邮箱设置转发目标

在用户侧左侧邮箱列表中：
1) 找到邮箱（account）
2) 点击右侧 **设置（⚙️）** → **转发设置**
3) 填写目标邮箱（可多个，逗号分隔/逐个回车添加）
4) 开启开关并保存

接口方式（脚本/自动化）见：`doc/mailbox-forwarding.md`

---

## 6. 收件流程说明（“为什么会到目标邮箱”）

典型流程如下：

1) 发件方 → 投递到 `xxx@example.com`
2) Cloudflare Email Routing 命中路由规则 → 把邮件交给 Worker（触发 `email()`）
3) Worker：
   - 读取系统设置（KV）
   - 解析邮件并写入 D1（邮件列表因此可见）
   - 若开启外部转发：按“邮箱级配置优先、否则系统级配置”的目标列表调用 `message.forward(<目标邮箱>)`
4) Cloudflare 将邮件转发到已验证的 Destination address（目标邮箱收件）

当 Worker 抛异常时，Cloudflare 会重试最多 3 次，仍失败则对发件方回退/退信，常见表现：
- `Rejected reason: upstream (worker:cloud-mail) temporary error: Worker call failed after 3 attempts`

---

## 7. 常见问题与排查（你遇到的大多在这里）

### 7.1 `c3.env.kv.put is not a function` / `env.kv.get is not a function`

原因：
- `kv` 没有绑定为 KV Namespace（或者被同名变量/密钥覆盖成字符串）

处理：
1) Worker → **Settings** → **Bindings** → 确认有 **KV Namespace**，绑定名为 `kv`
2) Worker → **Settings** → **Variables** / **Secrets** → 删除任何名为 `kv` 的变量/密钥
3) 重新部署，再访问一次初始化：`/api/init/<jwt_secret>`

---

### 7.2 “所有邮件显示接收，但 Delivery Failed / Worker call failed after 3 attempts”

这代表 Worker 的 `email()` 抛异常或绑定缺失。按下面顺序排查：

1) 先看 Worker 日志（必须）
- Cloudflare 控制台 → Worker → **Logs**
- 或本地：`wrangler tail cloud-mail`

2) 检查绑定是否齐全（最常见）
- D1：`db`
- KV：`kv`
-（可选）R2：`r2`

3) 检查是否已初始化（非常常见）
- 访问：`/api/init/<jwt_secret>` 返回 `success`

4) 检查变量 `domain` 格式（非常常见）
- 必须是 JSON 数组：`["example.com"]`
- 不能写成：`example.com`

5) 如日志出现缺字段（例如 `no such column: forward_email`）
- 说明 D1 没跑到新迁移：再执行一次 `/api/init/<jwt_secret>`

---

### 7.3 初始化时出现 `skip column: duplicate column name ...`

含义：
- 你已经跑过该字段迁移了（重复执行 init 会出现）
- 不影响使用

> 重复执行 init 看到这些日志属正常，不影响使用；最新版已对部分迁移改为「按列存在性判断」，会减少此类日志，但不保证完全消除。

---
