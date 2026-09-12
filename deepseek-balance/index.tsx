import * as scriptingNS from "scripting"
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
  apiKeyBackend,
  clearApiKey,
  clearCache,
  currencySymbol,
  formatAmount,
  formatTime,
  getApiKey,
  getKeychainError,
  hasApiKey,
  loadCache,
  loadConfig,
  maskApiKey,
  refreshBalance,
  relativeTime,
  saveApiKey,
  saveConfig,
  selfTest,
} from "./balance"

const SCRIPT_VERSION = "1.0.6"
const BRAND = "#4D6BFE"

// Dialog / Pasteboard 在不同版本里可能是全局命名空间，也可能从模块导出，这里都兜住
const NS: any = scriptingNS as any
const globalScope: any = globalThis as any
const DialogAPI: any = NS.Dialog ?? globalScope.Dialog ?? null
const PasteboardAPI: any = NS.Pasteboard ?? globalScope.Pasteboard ?? null

/* --------------------------- 安全读取封装 --------------------------- */

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

function safeBackend(): string {
  try {
    const backend = apiKeyBackend()
    if (backend === "keychain") return "iOS 钥匙串"
    if (backend === "storage") return "脚本本地存储"
    return "未存储"
  } catch (e) {
    return "未知"
  }
}

function safeKeychainError(): string {
  try {
    return getKeychainError()
  } catch (e) {
    return ""
  }
}

function safeSelfTest(): string[] {
  try {
    return selfTest()
  } catch (error) {
    return [`自检本身出错：${error instanceof Error ? error.message : error}`]
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
      lineLimit={1}
    >{value}</Text>
  </HStack>
}

function SettingsView() {
  const dismiss = Navigation.useDismiss()

  const [config, setConfig] = useState(safeConfig())
  const [keyInput, setKeyInput] = useState("")
  const [keySaved, setKeySaved] = useState(safeHasKey())
  const [keyLabel, setKeyLabel] = useState(safeKeyLabel())
  const [keyBackendLabel, setKeyBackendLabel] = useState(safeBackend())
  const [keyErrorMessage, setKeyErrorMessage] = useState(safeKeychainError())

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(`脚本版本 ${SCRIPT_VERSION} · 已就绪`)
  const [tone, setTone] = useState("secondaryLabel")

  const [infos, setInfos] = useState<BalanceInfo[]>([])
  const [available, setAvailable] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [diag, setDiag] = useState<string[]>([])
  const [toastText, setToastText] = useState("")
  const [showToast, setShowToast] = useState(false)

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

  function syncKeyState() {
    setKeySaved(safeHasKey())
    setKeyLabel(safeKeyLabel())
    setKeyBackendLabel(safeBackend())
    setKeyErrorMessage(safeKeychainError())
  }

  function applyKey(rawText: string) {
    const value = (rawText ?? "").trim()
    if (value.length === 0) {
      setStatus("内容为空，没有保存")
      setTone("systemOrange")
      return
    }

    setStatus("正在保存…")
    setTone("secondaryLabel")

    let result
    try {
      result = saveApiKey(value)
    } catch (error) {
      const message = `保存异常：${error instanceof Error ? error.message : error}`
      setStatus(message)
      setTone("systemRed")
      setToastText(message)
      setShowToast(true)
      return
    }

    syncKeyState()
    setKeyInput("")

    const backendText = result.backend === "keychain" ? "iOS 钥匙串（系统加密）"
      : result.backend === "storage" ? "脚本本地存储（明文，仅本机沙盒）"
        : "未写入"

    const detail = result.ok
      ? `结果：保存成功${result.verified ? "（回读校验通过）" : "（⚠️ 回读校验不一致）"}\n存储位置：${backendText}\nKey：${result.masked}（${result.length} 字符）${result.error.length > 0 ? `\n说明：钥匙串不可用 —— ${result.error}` : ""}`
      : `结果：保存失败\n原因：${result.error}`

    setStatus(detail.replace(/\n/g, " · "))
    setTone(result.ok ? (result.backend === "keychain" ? "systemGreen" : "systemOrange") : "systemRed")
    setToastText(result.ok
      ? `✅ 已保存到${result.backend === "keychain" ? "钥匙串" : "本地存储"}`
      : `❌ 保存失败`)
    setShowToast(true)

    if (DialogAPI != null && typeof DialogAPI.alert === "function") {
      try {
        DialogAPI.alert({
          title: result.ok ? "API Key 已保存" : "API Key 保存失败",
          message: detail,
        }).catch(() => {
          // 忽略
        })
      } catch (error) {
        // 忽略
      }
    }
  }

  async function inputKeyWithDialog() {
    if (DialogAPI == null || typeof DialogAPI.prompt !== "function") {
      setStatus("当前版本没有 Dialog.prompt，请改用剪贴板或下面的输入框")
      setTone("systemOrange")
      return
    }
    try {
      const text = await DialogAPI.prompt({
        title: "输入 DeepSeek API Key",
        message: "以 sk- 开头，只保存在本机",
        placeholder: "sk-xxxxxxxx",
        obscureText: true,
        confirmLabel: "保存",
        cancelLabel: "取消",
      })
      if (text == null) {
        setStatus("已取消输入")
        setTone("secondaryLabel")
        return
      }
      applyKey(text)
    } catch (error) {
      setStatus(`对话框出错：${error instanceof Error ? error.message : error}`)
      setTone("systemRed")
    }
  }

  async function importKeyFromClipboard() {
    if (PasteboardAPI == null || typeof PasteboardAPI.getString !== "function") {
      setStatus("当前版本没有 Pasteboard.getString")
      setTone("systemOrange")
      return
    }
    try {
      const text = await PasteboardAPI.getString()
      if (text == null || `${text}`.trim().length === 0) {
        setStatus("剪贴板里没有文本（可从其他 App 复制后重试）")
        setTone("systemOrange")
        return
      }
      applyKey(`${text}`)
    } catch (error) {
      setStatus(`读剪贴板出错：${error instanceof Error ? error.message : error}`)
      setTone("systemRed")
    }
  }

  function saveFromField() {
    applyKey(keyInput)
  }

  function removeKey() {
    try {
      clearApiKey()
    } catch (error) {
      // 忽略
    }
    syncKeyState()
    setInfos([])
    setUpdatedAt(0)
    setStatus("已清除 API Key")
    setTone("systemOrange")
    Widget.reloadAll()
  }

  function runSelfTest() {
    const lines = safeSelfTest()
    setDiag(lines)
    setStatus("自检完成，结果见下方「自检」")
    setTone("secondaryLabel")
  }

  async function doRefresh() {
    let key = ""
    try {
      key = getApiKey()
    } catch (error) {
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
      setStatus("余额已更新")
      setTone("systemGreen")
      Widget.reloadAll()
    } catch (error) {
      setStatus(`刷新失败：${error instanceof Error ? error.message : error}`)
      setTone("systemRed")
    } finally {
      setBusy(false)
    }
  }

  const primary = infos.length
    ? infos.find(info => info.currency?.toUpperCase() === "CNY") ?? infos[0]
    : null
  const symbol = primary != null ? currencySymbol(primary.currency) : "¥"

  return <NavigationStack>
    <List
      navigationTitle={"DeepSeek 余额"}
      navigationBarTitleDisplayMode={"inline"}
      toast={{
        isPresented: showToast,
        onChanged: setShowToast,
        message: toastText,
        duration: 2.5,
        position: "top",
      }}
      toolbar={{
        cancellationAction: <Button
          title={"完成"}
          action={dismiss}
        />,
      }}
    >
      <Section
        header={<Text>状态</Text>}
      >
        <Text
          font={"subheadline"}
          foregroundStyle={tone}
          lineLimit={6}
        >{status}</Text>
        <InfoRow label={"脚本版本"} value={SCRIPT_VERSION} />
        <InfoRow label={"运行环境"} value={`${Script.env}`} />
        <InfoRow label={"App 内版本"} value={`${Script.metadata?.version ?? "?"}`} />
        <Button
          title={"运行自检（诊断存储/权限）"}
          systemImage={"stethoscope"}
          action={runSelfTest}
        />
      </Section>

      <Section
        header={<Text>账户</Text>}
      >
        <HStack>
          <VStack alignment={"leading"} spacing={2}>
            <Text
              font={26}
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
                ? `${primary.currency} · 赠送 ${symbol}${formatAmount(primary.granted_balance)} · 充值 ${symbol}${formatAmount(primary.topped_up_balance)}`
                : "暂无数据"}
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
        footer={<Text>钥匙串（Keychain）里的 Key 由 iOS 加密保管、不随备份同步；若该环境不支持钥匙串，会自动退回脚本本地存储（App 沙盒内的明文，仅本机可读）。两种方式都不会把 Key 发送给除 api.deepseek.com 以外的任何服务器。</Text>}
      >
        <InfoRow
          label={"当前 Key"}
          value={keyLabel}
          color={keySaved ? "systemGreen" : "systemOrange"}
        />
        <InfoRow
          label={"存储位置"}
          value={keyBackendLabel}
          color={keySaved ? "systemGreen" : "systemOrange"}
        />
        {keyErrorMessage.length > 0
          ? <Text
            font={"footnote"}
            foregroundStyle={"systemOrange"}
            lineLimit={4}
          >钥匙串提示：{keyErrorMessage}</Text>
          : null}
        <Button
          title={"对话框输入 Key"}
          systemImage={"keyboard"}
          action={inputKeyWithDialog}
        />
        <Button
          title={"从剪贴板导入 Key"}
          systemImage={"doc.on.clipboard"}
          action={importKeyFromClipboard}
        />
        <SecureField
          title={"新 Key"}
          value={keyInput}
          onChanged={setKeyInput}
          prompt={"sk-xxxxxxxx"}
        />
        <InfoRow label={"已输入"} value={`${keyInput.trim().length} 字符`} />
        <Button
          title={"保存上面输入框里的 Key"}
          systemImage={"square.and.arrow.down"}
          action={saveFromField}
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
        footer={<Text>{'主屏长按小组件 → 编辑小组件 → 选脚本 “DeepSeek 余额”；参数可填 {"currency":"USD","refreshMinutes":15}'}</Text>}
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
          title={"刷新主屏幕小组件"}
          systemImage={"arrow.triangle.2.circlepath"}
          action={() => Widget.reloadAll()}
        />
      </Section>

      {diag.length > 0
        ? <Section header={<Text>自检</Text>}>
          {diag.map((line, index) =>
            <Text
              key={`${index}`}
              font={"footnote"}
              lineLimit={3}
            >{line}</Text>
          )}
        </Section>
        : null}

      <Section
        header={<Text>维护</Text>}
      >
        <Button
          title={"清除余额缓存"}
          role={"destructive"}
          action={() => {
            clearCache()
            setInfos([])
            setUpdatedAt(0)
            setStatus("缓存已清除")
            setTone("systemOrange")
          }}
        />
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
