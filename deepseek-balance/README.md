# DeepSeek 余额小组件（Scripting）

在 iPhone 主屏幕上显示 DeepSeek API 账户余额的小组件，基于 Scripting App（TSX + SwiftUI 风格语法）。

## 功能

- **余额展示**：大号金额（等宽数字、圆角字体），自动按 DeepSeek 返回的 `balance_infos` 选择币种（默认 CNY 优先）
- **账户状态**：`is_available` 绿点 / 异常提示
- **赠送 / 充值明细**：占比进度条（大尺寸）
- **今日消耗**：用每天记录的余额快照估算（大/中尺寸）
- **离线兜底**：网络失败时回落本地缓存并标记「离线 · x 分钟前」
- **低余额提醒**：低于阈值显示「余额不足」胶囊（默认 ¥10）
- **点击刷新**：小组件右上角 ⟳ 按钮（AppIntent），无需打开 App
- **安全**：API Key 存 Keychain（按脚本隔离），不写进代码、不进 Storage 明文

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `script.json` | 项目元数据（名称 / 图标 / 版本） |
| `widget.tsx` | 小组件入口，按 `Widget.family` 渲染小 / 中 / 大 / 锁屏布局 |
| `index.tsx` | App 内设置界面（Key、币种、刷新间隔、预览、缓存管理） |
| `app_intents.tsx` | 刷新按钮用的 AppIntent（定义必须放在此文件） |
| `balance.ts` | 数据层：配置、Keychain、`/user/balance` 请求、缓存、每日历史与格式化 |
| `tools/` | 仅本地自检用的 stub 与解析脚本，可不上传到 Scripting |

## 安装

1. 在 Scripting App 里新建一个脚本项目，名称填 **DeepSeek 余额**（名称要和 `script.json` 里一致，URL Scheme 会用到）。
2. 依次新建文件并粘贴内容：`script.json`、`balance.ts`、`widget.tsx`、`app_intents.tsx`、`index.tsx`。
3. 运行一次脚本（打开设置界面）→ 在 **API Key** 一行粘贴 `sk-...` → 点「保存 API Key」。
4. 回到主屏幕，添加 Scripting 小组件 → 长按 → 编辑小组件 → 脚本选 **DeepSeek 余额**。
5. 需要精确布局时，务必在主屏幕实测（App 内预览只是近似效果）。

## 小组件参数（可选）

长按小组件 → 编辑小组件 → 参数，支持 JSON 或纯字符串：

```json
{ "currency": "USD", "refreshMinutes": 15, "lowThreshold": 20 }
```

- `currency`：`auto`(默认，CNY 优先) / `CNY` / `USD`
- `refreshMinutes`：时间线刷新间隔（分钟），默认 30
- `lowThreshold`：低余额提醒阈值，默认 10
- `host` / `apiKey`：仅调试用，正常请留空（走 App 内配置与 Keychain）

也支持直接填 `CNY`（等价于 `{"currency":"CNY"}`）。

## 接口说明

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <API_KEY>
```

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "9.62",
      "granted_balance": "0.00",
      "topped_up_balance": "9.62"
    }
  ]
}
```

## 已知限制

- 小组件的刷新时机由 iOS 的 WidgetKit 决定，最长会有一小时级别的延迟；`⟳` 按钮可强制即时刷新。
- 「今日消耗」依赖本机每天生成的余额快照，首次使用当天无参考值，会显示 `—`。
- 余额为按量计费，实际扣费有延迟，与账单页可能略有差异。

## 排查：小组件空白

1. 小组件最底一行会输出状态串，例如 `v2.0 · 更新 19:24 · 3 分钟前`。
   - 能看到这行 → 脚本已正常渲染，只是没有 Key 或余额为空（中间会写「未设置 API Key」）；
   - 完全空白 → 先确认主屏小组件「编辑小组件」里选的脚本名确实是本项目。
2. 用 10 秒最小脚本验证环境（新建一个脚本，只写这两行，加到主屏）：

   ```tsx
   import { Text, Widget } from "scripting"
   Widget.present(<Text font={20}>Hello Scripting</Text>)
   ```

   能显示 = 环境正常，问题在脚本本身；也空白 = 属 Scripting 的小组件配置问题。
3. v2.0 起 widget.tsx 只用 Text/VStack/HStack/Spacer 排版，并整体包了 try/catch：
   任何异常都会把错误文字画在小组件上（红色标题 `DeepSeek v2.0 出错`），不会静默白屏。
4. App 内运行时若界面空白，先看 Scripting 的日志面板；index.tsx 现在也会把异常直接呈现出来。
