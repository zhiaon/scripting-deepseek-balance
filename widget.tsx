import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import {
  currencySymbol,
  formatAmount,
  formatTime,
  getApiKey,
  loadCache,
  loadConfig,
  loadHistory,
  parseWidgetOptions,
  pickInfo,
  refreshBalance,
  relativeTime,
  spendToday,
} from "./balance"

/**
 * 安全版小组件（v2）
 * 原则：所有数据在模块作用域一次性算完（并整体 try/catch），
 * 组件体内只做纯文本排版 —— 不使用 Link / Button / ProgressView / widgetBackground 等高风险修饰符，
 * 出错时也会把错误文字画在小组件上，绝不出现空白。
 */

const VERSION = "v2.0"
const BRAND = "#4D6BFE"
const GREEN = "#10B981"
const AMBER = "#F59E0B"
const RED = "#EF4444"

type Snapshot = {
  fatal: string
  family: string
  symbol: string
  totalText: string
  statusText: string
  statusColor: string
  breakdownText: string
  footerText: string
  hasKey: boolean
  isLow: boolean
  currency: string
  totalNumber: number
}

function blank(reason: string): Snapshot {
  return {
    fatal: reason,
    family: "unknown",
    symbol: "¥",
    totalText: "--",
    statusText: "初始化失败",
    statusColor: RED,
    breakdownText: "",
    footerText: `${VERSION} · ${reason}`,
    hasKey: false,
    isLow: false,
    currency: "",
    totalNumber: NaN,
  }
}

async function collect(): Promise<Snapshot> {
  const family = `${Widget.family}`

  const config = loadConfig()
  const options = parseWidgetOptions(Widget.parameter)
  const apiKey = (options.apiKey ?? "").trim() || getApiKey()
  const host = options.host ?? config.host
  const preferCurrency = options.currency ?? config.currency
  const lowThreshold = options.lowThreshold ?? config.lowThreshold

  const cached = loadCache()

  let infos = cached != null ? cached.infos : []
  let available = cached != null ? cached.available : false
  let updatedAt = cached != null ? cached.ts : 0
  let statusText = ""
  let statusColor = GREEN
  let note = ""

  if (apiKey.length === 0) {
    statusText = "未设置 API Key（运行脚本去设置）"
    statusColor = AMBER
  } else {
    // 缓存够新就不再等网络，避免小组件超时白屏
    const fresh = cached != null && Date.now() - cached.ts < 10 * 60 * 1000
    if (!fresh) {
      try {
        const result = await refreshBalance(host, apiKey)
        infos = result.data.balance_infos
        available = result.data.is_available
        updatedAt = result.updatedAt
      } catch (error) {
        note = error instanceof Error ? error.message : `${error}`
        statusColor = cached != null ? AMBER : RED
      }
    }
  }

  const info = pickInfo(infos, preferCurrency)
  const symbol = info != null ? currencySymbol(info.currency) : "¥"
  const currency = info != null ? info.currency : "CNY"
  const totalText = info != null ? formatAmount(info.total_balance) : "--"
  const grantedText = info != null ? formatAmount(info.granted_balance) : "--"
  const toppedText = info != null ? formatAmount(info.topped_up_balance) : "--"
  const totalNumber = info != null ? Number(info.total_balance) : NaN
  const isLow = Number.isFinite(totalNumber) && totalNumber <= lowThreshold

  if (statusText.length === 0) {
    if (note.length > 0) {
      statusText = `${currency} · 离线（${note}）`
    } else if (info != null) {
      statusText = available ? `${currency} 可用` : `${currency} 账户不可用`
      statusColor = available ? GREEN : RED
    } else {
      statusText = "暂无数据"
      statusColor = AMBER
    }
  }

  const spend = Number.isFinite(totalNumber) ? spendToday(totalNumber, loadHistory()) : null
  const breakdownText = info != null
    ? `赠送 ${symbol}${grantedText} · 充值 ${symbol}${toppedText}${spend != null ? ` · 今日 ${symbol}${formatAmount(spend)}` : ""}`
    : ""

  const timeText = updatedAt > 0 ? formatTime(updatedAt) : "--"
  const footerText = `${VERSION} · ${isLow ? "余额不足 · " : ""}更新 ${timeText} · ${updatedAt > 0 ? relativeTime(updatedAt) : "无缓存"}`

  return {
    fatal: "",
    family,
    symbol,
    totalText,
    statusText,
    statusColor,
    breakdownText,
    footerText,
    hasKey: apiKey.length > 0,
    isLow,
    currency,
    totalNumber,
  }
}

let snapshot: Snapshot
try {
  snapshot = await collect()
} catch (error) {
  snapshot = blank(error instanceof Error ? `${error.message}` : `${error}`)
}

function ErrorView() {
  return <VStack
    alignment={"leading"}
    spacing={4}
    padding={{ horizontal: 14, vertical: 12 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
  >
    <Text
      font={12}
      fontWeight={"bold"}
      foregroundStyle={RED}
    >DeepSeek {VERSION} 出错</Text>
    <Text
      font={11}
      lineLimit={6}
    >{snapshot.fatal}</Text>
  </VStack>
}

function MainView() {
  const size = snapshot.family === "systemSmall" ? 26
    : snapshot.family === "systemLarge" ? 40
      : 32
  const isSmall = snapshot.family === "systemSmall"

  return <VStack
    alignment={"leading"}
    spacing={3}
    padding={{ horizontal: 14, vertical: 12 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
  >
    <HStack spacing={5}>
      <Text
        font={11}
        fontWeight={"bold"}
        foregroundStyle={BRAND}
      >DeepSeek</Text>
      <Spacer />
      <Text
        font={10}
        foregroundStyle={snapshot.statusColor}
        lineLimit={1}
      >{snapshot.isLow ? "余额不足" : "●"}</Text>
    </HStack>

    <Spacer />

    <Text
      font={size}
      fontWeight={"bold"}
      fontDesign={"rounded"}
      monospacedDigit
      lineLimit={1}
      minScaleFactor={0.5}
    >{snapshot.symbol}{snapshot.totalText}</Text>

    <Text
      font={11}
      foregroundStyle={"secondaryLabel"}
      lineLimit={1}
    >{snapshot.statusText}</Text>

    <Spacer />

    {!isSmall && snapshot.breakdownText.length > 0
      ? <Text
        font={11}
        foregroundStyle={"secondaryLabel"}
        lineLimit={1}
      >{snapshot.breakdownText}</Text>
      : null}

    <Text
      font={10}
      foregroundStyle={"tertiaryLabel"}
      lineLimit={1}
    >{snapshot.footerText}</Text>
  </VStack>
}

function WidgetView() {
  if (snapshot.fatal.length > 0) return <ErrorView />
  return <MainView />
}

// 失败时 5 分钟后重试，正常按配置间隔刷新
const reloadMinutes = snapshot.fatal.length > 0 ? 5 : 30
Widget.present(<WidgetView />, {
  policy: "after",
  date: new Date(Date.now() + reloadMinutes * 60 * 1000),
})
