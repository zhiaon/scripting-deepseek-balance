import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  Toggle,
  VStack,
  Widget,
  useEffect,
  useState,
} from "scripting"
import {
  BalanceInfo,
  clearApiKey,
  clearCache,
  currencySymbol,
  formatAmount,
  formatTime,
  getApiKey,
  hasApiKey,
  loadCache,
  loadConfig,
  maskApiKey,
  refreshBalance,
  relativeTime,
  saveConfig,
  setApiKey,
} from "./balance"

const BRAND = "#4D6BFE"

// 所有可能抛错的原生读取都包一层，保证界面不会因为读配置/钥匙串失败而白屏
function safeConfig() {
  try {
    return loadConfig()
  } catch (e) {
    return { host: "https://api.deepseek.com", currency: "auto", refreshMinutes: 30, hideBreakdown: false, lowThreshold: 10 }
  }
}

function safeHasKey(): boolean {
  try {
    return hasApiKey()
  } catch (e) {
    return false
  }
}

function safeKeyLabel(): string {
  try {
    return maskApiKey(getApiKey())
  } catch (e) {
    return "读取失败"
  }
}

function InfoRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return <HStack>
    <Text>{label}</Text>
    <Spacer />
    <Text
      foregroundStyle={color ?? "secondaryLabel"}
      monospacedDigit
    >{value}</Text>
  </HStack>
}

function SettingsView() {
  const dismiss = Navigation.useDismiss()

  const [config, setConfig] = useState(safeConfig())
  const [keyInput, setKeyInput] = useState("")
  const [keySaved, setKeySaved] = useState(safeHasKey())
  const [keyLabel, setKeyLabel] = useState(safeKeyLabel())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [tone, setTone] = useState("secondaryLabel")

  const [infos, setInfos] = useState<BalanceInfo[]>([])
  const [available, setAvailable] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [fetchedAt, setFetchedAt] = useState(0)

  // 首次进入：先用缓存里的数据渲染，避免白屏
  useEffect(() => {
    const cache = loadCache()
    if (cache != null) {
      setInfos(cache.infos)
      setAvailable(cache.available)
      setUpdatedAt(cache.ts)
    }
  }, [])

  function update(patch: Partial<typeof config>) {
    const next = { ...config, ...patch }
    setConfig(next)
    saveConfig(next)
  }

  async function doRefresh() {
    let key = ""
    try {
      key = getApiKey()
    } catch (e) {
      key = ""
    }
    if (!key) {
      setStatus("请先保存 API Key")
      setTone("systemOrange")
      return
    }
    setBusy(true)
    setStatus("正在请求 DeepSeek…")
    setTone("secondaryLabel")
    try {
      const result = await refreshBalance(config.host, key)
      setInfos(result.data.balance_infos)
      setAvailable(result.data.is_available)
      setUpdatedAt(result.updatedAt)
      setFetchedAt(Date.now())
      setStatus("已更新")
      setTone("systemGreen")
      Widget.reloadAll()
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : error}`)
      setTone("systemRed")
    } finally {
      setBusy(false)
    }
  }

  function saveKey() {
    const value = keyInput.trim()
    if (!value) return
    const ok = setApiKey(value)
    setKeySaved(ok)
    setKeyLabel(safeKeyLabel())
    setKeyInput("")
    setStatus(ok ? "API Key 已保存到钥匙串" : "保存失败")
    setTone(ok ? "systemGreen" : "systemRed")
  }

  function removeKey() {
    clearApiKey()
    setKeySaved(false)
    setKeyLabel(safeKeyLabel())
    setInfos([])
    setUpdatedAt(0)
    setFetchedAt(0)
    setStatus("已清除 API Key")
    setTone("systemOrange")
    Widget.reloadAll()
  }

  const primary = infos.length
    ? infos.find(info => info.currency?.toUpperCase() === "CNY") ?? infos[0]
    : null
  const symbol = primary != null ? currencySymbol(primary.currency) : "¥"

  return <NavigationStack>
    <List
      navigationTitle={"DeepSeek 余额"}
      navigationBarTitleDisplayMode={"inline"}
      toolbar={{
        cancellationAction: <Button
          title={"完成"}
          action={dismiss}
        />,
      }}
    >
      <Section
        header={<Text>账户</Text>}
      >
        <HStack>
          <VStack alignment={"leading"} spacing={2}>
            <Text
              font={28}
              fontWeight={"bold"}
              fontDesign={"rounded"}
              foregroundStyle={BRAND}
              monospacedDigit
            >
              {primary != null ? `${symbol}${formatAmount(primary.total_balance)}` : "--"}
            </Text>
            <Text
              font={"footnote"}
              foregroundStyle={"secondaryLabel"}
            >
              {primary != null
                ? `${primary.currency} 可用余额 · 赠送 ${symbol}${formatAmount(primary.granted_balance)} · 充值 ${symbol}${formatAmount(primary.topped_up_balance)}`
                : "暂无数据，点击下方按钮刷新"}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
        <InfoRow label={"账户状态"} value={primary != null ? (available ? "可用" : "不可用") : "--"} />
        <InfoRow
          label={"数据时间"}
          value={updatedAt ? `${formatTime(updatedAt)} · ${relativeTime(updatedAt)}` : "从未更新"}
        />
        <Button
          title={busy ? "刷新中…" : "立即刷新"}
          systemImage={"arrow.clockwise"}
          action={doRefresh}
          disabled={busy}
        />
      </Section>

      <Section
        header={<Text>API Key</Text>}
        footer={<Text>Key 只写入本机钥匙串（按脚本隔离，其他脚本读不到），请求直接发往 api.deepseek.com，不经过任何第三方服务器。</Text>}
      >
        <InfoRow
          label={"当前 Key"}
          value={keyLabel}
          color={keySaved ? "systemGreen" : "systemOrange"}
        />
        <SecureField
          title={"新 Key"}
          value={keyInput}
          onChanged={setKeyInput}
          prompt={"sk-xxxxxxxx"}
        />
        <Button
          title={"保存 API Key"}
          action={saveKey}
          disabled={keyInput.trim().length === 0}
        />
        {keySaved
          ? <Button
            title={"清除 API Key"}
            role={"destructive"}
            action={removeKey}
          />
          : null}
      </Section>

      <Section
        header={<Text>显示</Text>}
        footer={<Text>刷新间隔同时决定小组件下一次请求时间线的时间；系统可能因电量等原因延后刷新。</Text>}
      >
        <Picker
          title={"币种"}
          value={config.currency}
          onChanged={value => update({ currency: `${value}` })}
        >
          <Text tag={"auto"}>自动（优先 CNY）</Text>
          <Text tag={"CNY"}>CNY 人民币</Text>
          <Text tag={"USD"}>USD 美元</Text>
        </Picker>
        <Picker
          title={"刷新间隔"}
          value={config.refreshMinutes}
          onChanged={value => update({ refreshMinutes: Number(value) })}
        >
          <Text tag={15}>15 分钟</Text>
          <Text tag={30}>30 分钟</Text>
          <Text tag={60}>1 小时</Text>
          <Text tag={180}>3 小时</Text>
        </Picker>
        <Picker
          title={"低余额提醒"}
          value={config.lowThreshold}
          onChanged={value => update({ lowThreshold: Number(value) })}
        >
          <Text tag={5}>{`${symbol}5`}</Text>
          <Text tag={10}>{`${symbol}10`}</Text>
          <Text tag={20}>{`${symbol}20`}</Text>
          <Text tag={50}>{`${symbol}50`}</Text>
        </Picker>
        <Toggle
          title={"隐藏赠送/充值明细"}
          value={config.hideBreakdown}
          onChanged={value => update({ hideBreakdown: value })}
        />
      </Section>

      <Section
        header={<Text>小组件</Text>}
        footer={<Text>{'长按主屏幕小组件 → 编辑小组件 → 选择脚本 “DeepSeek 余额”；参数可填 JSON，例如 {"currency":"USD","refreshMinutes":15}，也可直接填 "CNY"。'}</Text>}
      >
        <Button
          title={"预览小尺寸"}
          systemImage={"rectangle"}
          action={async () => {
            await Widget.preview({ family: "systemSmall" })
          }}
        />
        <Button
          title={"预览中尺寸"}
          systemImage={"rectangle"}
          action={async () => {
            await Widget.preview({ family: "systemMedium" })
          }}
        />
        <Button
          title={"预览大尺寸"}
          systemImage={"rectangle"}
          action={async () => {
            await Widget.preview({ family: "systemLarge" })
          }}
        />
        <Button
          title={"刷新主屏幕小组件"}
          systemImage={"arrow.triangle.2.circlepath"}
          action={() => Widget.reloadAll()}
        />
      </Section>

      <Section
        header={<Text>维护</Text>}
        footer={<Text>清除缓存只会删除本机保存的余额结果与每日历史，不影响 API Key 和服务端数据。</Text>}
      >
        <Button
          title={"清除余额缓存"}
          role={"destructive"}
          action={() => {
            clearCache()
            setInfos([])
            setUpdatedAt(0)
            setFetchedAt(0)
            setStatus("缓存已清除")
            setTone("systemOrange")
          }}
        />
      </Section>

      <Section>
        <Text
          font={"footnote"}
          foregroundStyle={tone}
        >{status.length ? status : `最近一次手动刷新：${fetchedAt ? formatTime(fetchedAt) : "—"}`}</Text>
      </Section>
    </List>
  </NavigationStack>
}

async function run() {
  try {
    await Navigation.present({
      element: <SettingsView />,
    })
  } catch (error) {
    // 任何异常都显示出来，避免出现空白界面
    await Navigation.present({
      element: <VStack
        alignment={"leading"}
        spacing={10}
        padding={{ horizontal: 20, vertical: 24 }}
      >
        <Text
          font={"headline"}
          foregroundStyle={"systemRed"}
        >DeepSeek 余额 · 设置界面出错</Text>
        <Text
          font={"footnote"}
          lineLimit={20}
        >{error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : `${error}`}</Text>
      </VStack>,
    })
  }
  Script.exit()
}

run()
