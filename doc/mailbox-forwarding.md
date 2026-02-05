# 邮箱级转发（指定目标邮箱）配置指南

本指南适用于 `cloud-mail`，实现「每个邮箱（account）单独设置转发目标邮箱」：当某个邮箱收到新邮件时，优先按该邮箱自己的转发配置执行转发；若未配置，则回退到系统级「第三方邮箱」转发列表。

---

## 1. 前置条件（Cloudflare 控制台）

1) **已启用 Email Routing**
- Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
- 确保已创建路由（例如 Catch-all）并绑定到 `cloud-mail` Worker

2) **验证转发目标邮箱（必须）**
- Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing** → **Destination addresses（目标地址）**
- 点击 **Add destination address（添加目标地址）**，输入你要转发到的目标邮箱
- 去目标邮箱收取验证邮件，点确认链接完成验证

> 未验证的目标邮箱会导致 Worker 调用 `message.forward()` 失败。

---

## 2. 数据库升级（必须）

本功能新增了 `account.forward_email / account.forward_status` 字段，因此需要跑一次初始化迁移。

1) 先部署新版 `mail-worker`
- 路径：`cloud-mail/mail-worker`

2) 访问初始化接口（会自动补齐字段）
- 路径：`GET /api/init/:secret`
- `:secret` 就是你在 Workers 环境变量里配置的 `jwt_secret`

示例：
- `https://<你的域名>/api/init/<jwt_secret>`

返回 `success` 即表示迁移完成。

---

## 3. 开启「外部邮箱转发」总开关（系统级）

邮箱级转发受系统级转发总开关控制：需要先在系统设置里启用「第三方邮箱」转发开关（即使你不填系统级转发列表也可以）。

在管理后台：
1) 进入：**系统设置** → **邮件推送** → **第三方邮箱**
2) 打开开关（启用）
3) 系统级转发列表 `forwardEmail` 可留空（邮箱级转发会用每个邮箱自己的配置）

---

## 4. 配置「转发规则」（可选，但会影响是否转发）

系统设置里有「转发规则」会决定哪些收件地址允许触发转发：
1) 进入：**系统设置** → **邮件推送** → **转发规则**
2) 选择：
- **全部转发**：所有收件邮箱都允许触发转发
- **规则转发**：只对 `ruleEmail` 列表中的收件地址触发转发

如果你选择了 **规则转发**，请把要转发的收件邮箱地址（例如 `test@yourdomain.com`）加入 `ruleEmail`，否则不会转发。

---

## 5. 给某个邮箱设置转发目标（邮箱级）

在用户侧邮箱列表（左侧邮箱卡片）：
1) 找到要设置的邮箱（account）
2) 点击该邮箱右侧 **设置（⚙️）** 下拉菜单
3) 选择 **转发设置**
4) 输入目标邮箱（可多个，逐个回车添加）
5) 打开开关（启用）→ 点击保存

保存后，该邮箱收到新邮件会优先转发到你填写的目标邮箱列表。

---

## 6. 接口方式配置（可用于脚本/自动化）

### 6.1 设置转发
- URL：`PUT /api/account/setForward`
- Header：
  - `Authorization: <登录后获得的 JWT>`
  - `Content-Type: application/json`
- Body：

```json
{
  "accountId": 123,
  "forwardStatus": 0,
  "forwardEmail": "a@example.com,b@example.com"
}
```

说明：
- `forwardStatus`: `0` 启用，`1` 关闭
- `forwardEmail`: 多个用逗号分隔；传空字符串可清空

---

## 7. 字段与代码位置（便于排查）

- 数据表字段：
  - `account.forward_email` / `account.forward_status`
  - `setting.forward_email` / `setting.forward_status`
- 接口实现：
  - `cloud-mail/mail-worker/src/api/account-api.js`
  - `cloud-mail/mail-worker/src/service/account-service.js`
- 收件转发逻辑：
  - `cloud-mail/mail-worker/src/email/email.js`
- 前端入口（邮箱侧边栏转发设置）：
  - `cloud-mail/mail-vue/src/layout/account/index.vue`

---

## 8. 常见问题

1) **保存成功但没有转发**
- 检查系统设置里「第三方邮箱」开关是否开启
- 检查「转发规则」是否为规则转发且未把收件邮箱加入 `ruleEmail`

2) **日志里提示转发失败**
- 目标邮箱是否已在 Cloudflare Email Routing 的 Destination addresses 中验证

3) **升级后接口/收件报错缺字段**
- 说明还没执行初始化迁移：访问 `GET /api/init/<jwt_secret>` 再试

