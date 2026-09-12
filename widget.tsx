import {
  Button,
  Divider,
  HStack,
  Image,
  Link,
  ProgressView,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
} from "scripting"
import { RefreshBalanceIntent } from "./app_intents"
import {
  BalanceInfo,
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

const BRAND = "#4D6BFE"
const GREEN = "#10B981"
const AMBER = "#F59E0B"
const RED = "#EF4444"
const GRAY = "#8E8E93"

/* ---------------------------- 1. 读取配置 ---------------------------- */

const config = loadConfig()
const options = parseWidgetOptions(Widget.parameter)
const apiKey = (options.apiKey ?? "").trim() || getApiKey()
const host = options.host ?? config.host
const preferCurrency = options.currency ?? config.currency
const lowThreshold = options.lowThreshold ?? config.lowThreshold
const family = Widget.family

/* ------------------------- 2. 取数（缓存兜底） ------------------------- */

type State = "ok" | "stale" | "error" | "no-key"

type Snapshot = {
  state: State
  available: boolean
  infos: BalanceInfo[]
  updatedAt: number
  message: string
}

const cached = loadCache()
let snapshot: Snapshot
let reloadDate = new Date(Date.now() + config.refreshMinutes * 60 * 1000)

if (!apiKey) {
  snapshot = {
    state: "no-key",
    available: false,
    infos: [],
    updatedAt: 0,
    message: "未设置 API Key",
  }
} else {
  try {
    const result = await refreshBalance(host, apiKey)
    snapshot = {
      state: "ok",
      available: result.data.is_available,
      infos: result.data.balance_infos,
      updatedAt: result.updatedAt,
      message: "",
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`
    snapshot = cached != null
      ? {
        state: "stale",
        available: cached.available,
        infos: cached.infos,
        updatedAt: cached.ts,
        message,
      }
      : {
        state: "error",
        available: false,
        infos: [],
        updatedAt: 0,
        message,
      }
    // 失败时稍后重试，别等满一个刷新周期
    reloadDate = new Date(Date.now() + 5 * 60 * 1000)
  }
}

/* ---------------------------- 3. 展示数据 ---------------------------- */

const info = pickInfo(snapshot.infos, preferCurrency)
const symbol = info != null ? currencySymbol(info.currency) : "¥"
const currency = info != null ? info.currency : "CNY"
const total = info != null ? formatAmount(info.total_balance) : "--"
const granted = info != null ? formatAmount(info.granted_balance) : "--"
const topped = info != null ? formatAmount(info.topped_up_balance) : "--"

const totalNumber = info != null ? Number(info.total_balance) : NaN
const grantedNumber = info != null ? Number(info.granted_balance) : 0
const toppedNumber = info != null ? Number(info.topped_up_balance) : 0
const sum = grantedNumber + toppedNumber
const grantedRatio = sum > 0 ? grantedNumber / sum : 0
const isLow = Number.isFinite(totalNumber) && totalNumber <= lowThreshold

const spend = Number.isFinite(totalNumber) ? spendToday(totalNumber, loadHistory()) : null

const footerText =
  snapshot.state === "ok" ? `更新 ${formatTime(snapshot.updatedAt)}`
    : snapshot.state === "stale" ? `离线 · ${relativeTime(snapshot.updatedAt)}`
      : snapshot.state === "error" ? "刷新失败"
        : "未设置 API Key"

/* ----------------------------- 4. 小组件 ----------------------------- */

const rootPadding = { horizontal: 14, vertical: 12 }
const rootFrame = { maxWidth: "infinity" as const, maxHeight: "infinity" as const }

function Logo() {
  return <HStack spacing={5}>
    <Image
      systemName={"sparkles"}
      imageScale={"small"}
      foregroundStyle={BRAND}
    />
    <Text
      font={13}
      fontWeight={"bold"}
      foregroundStyle={BRAND}
    >DeepSeek</Text>
  </HStack>
}

function StatusIcon() {
  const name =
    snapshot.state === "error" ? "exclamationmark.triangle.fill"
      : snapshot.state === "no-key" ? "key.slash.fill"
        : snapshot.state === "stale" ? "wifi.slash"
          : "checkmark.circle.fill"

  const color =
    snapshot.state === "error" ? RED
      : snapshot.state === "no-key" ? GRAY
        : snapshot.state === "stale" ? AMBER
          : snapshot.available ? GREEN : AMBER

  return <Image
    systemName={name}
    imageScale={"small"}
    foregroundStyle={color}
  />
}

function RefreshButton() {
  return <Button
    intent={RefreshBalanceIntent(undefined)}
    buttonStyle={"plain"}
    tint={BRAND}
  >
    <Image
      systemName={"arrow.clockwise"}
      imageScale={"small"}
      foregroundStyle={BRAND}
    />
  </Button>
}

function AmountText({ size }: { size: number }) {
  return <Text
    font={size}
    fontWeight={"bold"}
    fontDesign={"rounded"}
    monospacedDigit
    lineLimit={1}
    minScaleFactor={0.5}
  >{symbol}{total}</Text>
}

function LowBadge() {
  if (!isLow) return null
  return <Text
    font={10}
    fontWeight={"semibold"}
    foregroundStyle={"white"}
    lineLimit={1}
    padding={{ horizontal: 6, vertical: 2 }}
    widgetBackground={{ style: AMBER, shape: "capsule" }}
  >余额不足</Text>
}

function BreakdownRow({
  label,
  value,
  ratio,
  color,
}: {
  label: string
  value: string
  ratio: number
  color: string
}) {
  return <VStack alignment={"leading"} spacing={3}>
    <HStack font={12}>
      <Text foregroundStyle={"secondaryLabel"}>{label}</Text>
      <Spacer />
      <Text fontWeight={"semibold"} monospacedDigit>{symbol}{value}</Text>
    </HStack>
    <ProgressView
      value={Math.max(0, Math.min(1, ratio))}
      total={1}
      progressViewStyle={"linear"}
      tint={color}
    />
  </VStack>
}

function SmallView() {
  return <Link url={Script.createRunURLScheme(Script.name)}>
    <VStack
      alignment={"leading"}
      spacing={2}
      padding={rootPadding}
      frame={rootFrame}
    >
      <HStack>
        <Logo />
        <Spacer />
        <StatusIcon />
      </HStack>
      <Spacer />
      <AmountText size={28} />
      <Text
        font={11}
        foregroundStyle={"secondaryLabel"}
        lineLimit={1}
      >{currency} 可用余额</Text>
      <Spacer />
      <HStack font={10} foregroundStyle={"secondaryLabel"}>
        {isLow ? <LowBadge /> : <Text lineLimit={1}>{footerText}</Text>}
        <Spacer />
        <RefreshButton />
      </HStack>
    </VStack>
  </Link>
}

function MediumView() {
  return <Link url={Script.createRunURLScheme(Script.name)}>
    <VStack
      alignment={"leading"}
      spacing={4}
      padding={rootPadding}
      frame={rootFrame}
    >
      <HStack spacing={6}>
        <Logo />
        <StatusIcon />
        <LowBadge />
        <Spacer />
        <Text font={10} foregroundStyle={"secondaryLabel"}>{footerText}</Text>
        <RefreshButton />
      </HStack>
      <Spacer />
      <HStack spacing={8} alignment={"leadingLastTextBaseline"}>
        <AmountText size={34} />
        <Text font={11} foregroundStyle={"secondaryLabel"}>{currency} 可用</Text>
      </HStack>
      {spend != null || !config.hideBreakdown
        ? <HStack spacing={10} font={11} foregroundStyle={"secondaryLabel"}>
          {!config.hideBreakdown
            ? <Text>赠送 {symbol}{granted}</Text>
            : null}
          {!config.hideBreakdown
            ? <Text>充值 {symbol}{topped}</Text>
            : null}
          {spend != null
            ? <Text>今日 {symbol}{formatAmount(spend)}</Text>
            : null}
        </HStack>
        : null}
    </VStack>
  </Link>
}

function LargeView() {
  return <Link url={Script.createRunURLScheme(Script.name)}>
    <VStack
      alignment={"leading"}
      spacing={10}
      padding={rootPadding}
      frame={rootFrame}
    >
      <HStack spacing={6}>
        <Logo />
        <StatusIcon />
        <LowBadge />
        <Spacer />
        <Text font={10} foregroundStyle={"secondaryLabel"}>{footerText}</Text>
        <RefreshButton />
      </HStack>

      <VStack alignment={"leading"} spacing={0}>
        <AmountText size={40} />
        <Text font={11} foregroundStyle={"secondaryLabel"}>
          {currency} 可用余额 · {snapshot.available ? "账户可用" : "账户不可用"}
        </Text>
      </VStack>

      <Divider />

      <VStack alignment={"leading"} spacing={8}>
        <BreakdownRow label={"赠送余额"} value={granted} ratio={grantedRatio} color={AMBER} />
        <BreakdownRow label={"充值余额"} value={topped} ratio={1 - grantedRatio} color={BRAND} />
      </VStack>

      <Divider />

      <HStack font={12} foregroundStyle={"secondaryLabel"}>
        <Text>今日消耗</Text>
        <Spacer />
        <Text fontWeight={"semibold"} monospacedDigit>
          {spend != null ? `${symbol}${formatAmount(spend)}` : "—"}
        </Text>
      </HStack>
      <HStack font={12} foregroundStyle={"secondaryLabel"}>
        <Text>低余额提醒</Text>
        <Spacer />
        <Text monospacedDigit>{symbol}{formatAmount(lowThreshold)}</Text>
      </HStack>

      <Spacer />

      <HStack font={10} foregroundStyle={"tertiaryLabel"}>
        <Text lineLimit={1}>数据来源 api.deepseek.com</Text>
        <Spacer />
        <Text>点击进入设置</Text>
      </HStack>
    </VStack>
  </Link>
}

function AccessoryView() {
  return <VStack alignment={"leading"} spacing={1}>
    <HStack spacing={4}>
      <Image systemName={"sparkles"} imageScale={"small"} foregroundStyle={BRAND} />
      <Text font={11} fontWeight={"bold"}>DeepSeek</Text>
    </HStack>
    <Text font={13} fontWeight={"bold"} monospacedDigit lineLimit={1}>
      {symbol}{total}
    </Text>
  </VStack>
}

function WidgetView() {
  switch (family) {
    case "systemSmall":
      return <SmallView />
    case "systemMedium":
      return <MediumView />
    case "systemLarge":
      return <LargeView />
    case "accessoryCircular":
    case "accessoryRectangular":
      return <AccessoryView />
    default:
      return <MediumView />
  }
}

// 渲染小组件；reloadPolicy 控制 WidgetKit 下次请求时间线的时间
Widget.present(<WidgetView />, { policy: "after", date: reloadDate })
