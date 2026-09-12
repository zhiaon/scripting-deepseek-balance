import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { getApiKey, loadConfig, refreshBalance } from "./balance"

/**
 * 小组件上的刷新按钮。
 * AppIntent 必须定义在 app_intents.tsx 中，执行时 Script.env === "app_intents"。
 */
export const RefreshBalanceIntent = AppIntentManager.register({
  name: "deepseek_balance_refresh",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (_: undefined) => {
    const apiKey = getApiKey()
    if (!apiKey) return

    const config = loadConfig()
    try {
      await refreshBalance(config.host, apiKey)
    } catch (e) {
      console.log(`DeepSeek 余额刷新失败: ${e}`)
    }
    Widget.reloadAll()
  },
})
