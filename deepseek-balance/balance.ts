declare const Keychain: any
declare const Storage: any

/**
 * 兼容层：官方示例里 Keychain / Storage 是全局命名空间（不 import）。
 * 这里用 declare + typeof 保护的方式取用，既不会因缺少导出而报错，
 * 也不会因 undefined 而静默失败。
 */
const globalScope: any = globalThis as any

function resolveAPI(name: string): any {
  try {
    if (name === "Keychain") {
      return typeof Keychain !== "undefined" ? Keychain : globalScope.Keychain
    }
    if (name === "Storage") {
      return typeof Storage !== "undefined" ? Storage : globalScope.Storage
    }
  } catch (error) {
    return globalScope[name] ?? null
  }
  return globalScope[name] ?? null
}

const KeychainAPI: any = resolveAPI("Keychain") ?? null
const StorageAPI: any = resolveAPI("Storage") ?? null

export function keychainAvailable(): boolean {
  return KeychainAPI != null && typeof KeychainAPI.get === "function"
}

export function storageAvailable(): boolean {
  return StorageAPI != null && typeof StorageAPI.get === "function"
}

/**
 * DeepSeek 余额数据层
 * - 配置存 Storage（非敏感）
 * - API Key 存 Keychain（按脚本隔离，安全）
 * - 余额结果缓存到 Storage，供小组件离线/超时时兜底
 */

export type BalanceInfo = {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export type BalanceData = {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

export type Config = {
  host: string
  /** "auto" | "CNY" | "USD" ... */
  currency: string
  /** 小组件时间线刷新间隔（分钟） */
  refreshMinutes: number
  /** 隐藏赠送/充值明细 */
  hideBreakdown: boolean
  /** 低余额提醒阈值 */
  lowThreshold: number
}

/** 小组件参数（编辑小组件时填写的 JSON，或省略） */
export type WidgetOptions = {
  apiKey?: string
  host?: string
  currency?: string
  refreshMinutes?: number
  lowThreshold?: number
}

export type Cache = {
  ts: number
  available: boolean
  infos: BalanceInfo[]
}

export type History = Record<string, { first: number; last: number; ts: number }>

export const API_KEY_ITEM = "deepseek.api_key"

const CONFIG_KEY = "deepseek.config"
const CACHE_KEY = "deepseek.cache"
const HISTORY_KEY = "deepseek.history"

export const DEFAULT_CONFIG: Config = {
  host: "https://api.deepseek.com",
  currency: "auto",
  refreshMinutes: 30,
  hideBreakdown: false,
  lowThreshold: 10,
}

/* ------------------------------- 配置 ------------------------------- */

export function loadConfig(): Config {
  const saved = storeRead<Partial<Config>>(CONFIG_KEY) ?? {}
  return { ...DEFAULT_CONFIG, ...saved }
}

export function saveConfig(config: Config): boolean {
  return storeWrite(CONFIG_KEY, config)
}

/** 解析小组件参数：支持 {"currency":"CNY"} 这种 JSON，也支持直接写 "CNY" */
export function parseWidgetOptions(raw: string | null | undefined): WidgetOptions {
  const text = (raw ?? "").trim()
  if (!text) return {}
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text)
      return typeof obj === "object" && obj !== null ? obj as WidgetOptions : {}
    } catch (e) {
      return {}
    }
  }
  return { currency: text }
}

/* --------------------------- 存储兼容封装 --------------------------- */

function storeRead<T>(key: string): T | null {
  if (!storageAvailable()) return null
  try {
    const value = StorageAPI.get(key)
    return (value ?? null) as T | null
  } catch (error) {
    return null
  }
}

function storeWrite(key: string, value: any): boolean {
  if (!storageAvailable()) return false
  try {
    return StorageAPI.set(key, value) !== false
  } catch (error) {
    return false
  }
}

function storeErase(key: string): void {
  if (!storageAvailable()) return
  try {
    StorageAPI.remove(key)
  } catch (error) {
    // 忽略
  }
}

function kcRead(key: string): { ok: boolean; value: string; error: string } {
  if (!keychainAvailable()) {
    return { ok: false, value: "", error: "Keychain 不可用（该版本未提供该模块）" }
  }
  try {
    const value = KeychainAPI.get(key)
    if (typeof value === "string") return { ok: true, value: value.trim(), error: "" }
    return { ok: true, value: "", error: "" }
  } catch (error) {
    return { ok: false, value: "", error: error instanceof Error ? error.message : `${error}` }
  }
}

function kcWrite(key: string, value: string): { ok: boolean; error: string } {
  if (!keychainAvailable()) {
    return { ok: false, error: "Keychain 不可用（该版本未提供该模块）" }
  }
  try {
    const result = KeychainAPI.set(key, value)
    return result === false ? { ok: false, error: "Keychain.set 返回 false" } : { ok: true, error: "" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `${error}` }
  }
}

function kcErase(key: string): boolean {
  if (!keychainAvailable()) return false
  try {
    KeychainAPI.remove(key)
    return true
  } catch (error) {
    return false
  }
}

/* ------------------------------ API Key ----------------------------- */

/**
 * 凭据存储：优先 Keychain；Keychain 不可用（模块缺失 / 抛错 / 返回 false）时
 * 自动退回脚本私有 Storage。所有路径都不向外抛异常。
 */

const STORAGE_KEY_ITEM = "deepseek.api_key.storage"

export type SaveKeyResult = {
  ok: boolean
  backend: "keychain" | "storage" | "none"
  error: string
  /** 写入后回读校验是否一致 */
  verified: boolean
  masked: string
  length: number
}

let keychainError = ""

export function getKeychainError(): string {
  return keychainError
}

export function getApiKey(): string {
  const fromKeychain = kcRead(API_KEY_ITEM)
  if (!fromKeychain.ok) keychainError = fromKeychain.error
  else keychainError = ""
  if (fromKeychain.value.length > 0) return fromKeychain.value

  const fromStorage = storeRead<string>(STORAGE_KEY_ITEM)
  return typeof fromStorage === "string" ? fromStorage.trim() : ""
}

/** 当前 Key 存在哪里（用于设置页展示） */
export function apiKeyBackend(): "keychain" | "storage" | "none" {
  if (kcRead(API_KEY_ITEM).value.length > 0) return "keychain"
  const fromStorage = storeRead<string>(STORAGE_KEY_ITEM)
  if (typeof fromStorage === "string" && fromStorage.trim().length > 0) return "storage"
  return "none"
}

export function saveApiKey(key: string): SaveKeyResult {
  const value = key.trim()
  if (value.length === 0) {
    return { ok: false, backend: "none", error: "内容为空", verified: false, masked: "", length: 0 }
  }

  const written = kcWrite(API_KEY_ITEM, value)
  if (written.ok) {
    keychainError = ""
    storeErase(STORAGE_KEY_ITEM)
    const readBack = kcRead(API_KEY_ITEM)
    return {
      ok: true,
      backend: "keychain",
      error: "",
      verified: readBack.ok && readBack.value === value,
      masked: maskApiKey(value),
      length: value.length,
    }
  }
  keychainError = written.error

  if (storeWrite(STORAGE_KEY_ITEM, value)) {
    const readBack = storeRead<string>(STORAGE_KEY_ITEM)
    return {
      ok: true,
      backend: "storage",
      error: written.error,
      verified: typeof readBack === "string" && readBack.trim() === value,
      masked: maskApiKey(value),
      length: value.length,
    }
  }
  return {
    ok: false,
    backend: "none",
    error: `${written.error} / 本地存储写入也失败`,
    verified: false,
    masked: "",
    length: value.length,
  }
}

/** 兼容旧调用：只关心成功与否 */
export function setApiKey(key: string): boolean {
  return saveApiKey(key).ok
}

export function clearApiKey(): boolean {
  const ok = kcErase(API_KEY_ITEM)
  storeErase(STORAGE_KEY_ITEM)
  return ok
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0
}

/** 运行时自检：把每个环节的真实结果吐出来，便于定位问题 */
export function selfTest(): string[] {
  const lines: string[] = []
  lines.push(`Keychain 模块：${keychainAvailable() ? "可用" : "不可用"}`)
  lines.push(`Storage 模块：${storageAvailable() ? "可用" : "不可用"}`)

  const probe = `probe.${Date.now()}`
  const written = kcWrite(probe, "1")
  lines.push(`Keychain.set：${written.ok ? "成功" : `失败（${written.error}）`}`)
  if (written.ok) {
    const read = kcRead(probe)
    lines.push(`Keychain.get：${read.ok ? (read.value === "1" ? "成功" : `异常返回（${read.value}）`) : `失败（${read.error}）`}`)
    kcErase(probe)
  }

  const storeOk = storeWrite(probe, "1")
  lines.push(`Storage.set：${storeOk ? "成功" : "失败"}`)
  const storeBack = storeRead<string>(probe)
  lines.push(`Storage.get：${storeBack === "1" ? "成功" : (storeBack == null ? "失败" : `异常返回（${storeBack}）`)}`)
  storeErase(probe)

  const backend = apiKeyBackend()
  lines.push(`当前 Key 存储位置：${backend === "keychain" ? "钥匙串" : backend === "storage" ? "本地存储" : "无"}`)
  if (keychainError.length > 0) lines.push(`最近钥匙串错误：${keychainError}`)
  return lines
}

/* ------------------------------ 网络请求 ----------------------------- */

export async function fetchBalance(host: string, apiKey: string): Promise<BalanceData> {
  const base = (host || DEFAULT_CONFIG.host).replace(/\/+$/, "")
  const response = await fetch(`${base}/user/balance`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 12,
    debugLabel: "DeepSeek Balance",
  })

  if (!response.ok) {
    if (response.status === 401) throw new Error("API Key 无效（401）")
    if (response.status === 403) throw new Error("无权限（403）")
    if (response.status === 404) throw new Error("接口不存在（404）")
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }

  const json = await response.json() as BalanceData
  if (json == null || !Array.isArray(json.balance_infos)) {
    throw new Error("返回数据格式异常")
  }
  return {
    is_available: json.is_available !== false,
    balance_infos: json.balance_infos,
  }
}

/** 拉取余额并更新缓存 / 历史记录 */
export async function refreshBalance(
  host: string,
  apiKey: string,
): Promise<{ data: BalanceData; updatedAt: number }> {
  const data = await fetchBalance(host, apiKey)
  const updatedAt = Date.now()
  saveCache({ ts: updatedAt, available: data.is_available, infos: data.balance_infos })
  recordHistory(data.balance_infos)
  return { data, updatedAt }
}

/* ------------------------------- 缓存 ------------------------------- */

export function loadCache(): Cache | null {
  const cache = storeRead<Cache>(CACHE_KEY)
  if (cache == null || !Array.isArray(cache.infos)) return null
  return cache
}

export function saveCache(cache: Cache): boolean {
  return storeWrite(CACHE_KEY, cache)
}

export function clearCache(): void {
  storeErase(CACHE_KEY)
  storeErase(HISTORY_KEY)
}

/* ------------------------------ 历史记录 ----------------------------- */

export function todayKey(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** 记录每天的首次/最新余额，用于估算“今日消耗” */
export function recordHistory(infos: BalanceInfo[]): History {
  const history = storeRead<History>(HISTORY_KEY) ?? {}
  const total = primaryTotal(infos)
  if (total == null) return history

  const key = todayKey()
  const today = history[key]
  history[key] = {
    first: today != null ? today.first : total,
    last: total,
    ts: Date.now(),
  }

  const keys = Object.keys(history).sort()
  while (keys.length > 30) {
    const oldest = keys.shift()
    if (oldest != null) delete history[oldest]
  }

  storeWrite(HISTORY_KEY, history)
  return history
}

export function loadHistory(): History {
  return storeRead<History>(HISTORY_KEY) ?? {}
}

/**
 * 今日消耗估算 = 上一次记录（通常是昨天）的余额 - 当前余额
 * 无历史记录或余额增加（充值）时返回 null / 0
 */
export function spendToday(currentTotal: number, history: History): number | null {
  const today = todayKey()
  const past = Object.keys(history).filter(key => key < today).sort()
  if (past.length === 0) return null
  const last = history[past[past.length - 1]].last
  const delta = last - currentTotal
  return delta > 0 ? delta : 0
}

/* ------------------------------ 展示工具 ----------------------------- */

/** 优先取 CNY，其次第一条 */
function primaryTotal(infos: BalanceInfo[]): number | null {
  if (!infos.length) return null
  const cny = infos.find(info => info.currency?.toUpperCase() === "CNY")
  const value = Number((cny ?? infos[0]).total_balance)
  return Number.isFinite(value) ? value : null
}

export function pickInfo(infos: BalanceInfo[], prefer: string): BalanceInfo | null {
  if (!infos.length) return null
  if (prefer && prefer !== "auto") {
    const matched = infos.find(info => info.currency?.toUpperCase() === prefer.toUpperCase())
    if (matched != null) return matched
  }
  return infos.find(info => info.currency?.toUpperCase() === "CNY") ?? infos[0]
}

export function currencySymbol(currency: string): string {
  switch ((currency || "").toUpperCase()) {
    case "CNY": return "¥"
    case "USD": return "$"
    case "EUR": return "€"
    case "JPY": return "¥"
    case "GBP": return "£"
    case "HKD": return "HK$"
    default: return ""
  }
}

export function formatAmount(value: string | number, digits = 2): string {
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return "--"
  return num.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function formatTime(ts: number): string {
  if (!ts) return "--"
  const date = new Date(ts)
  const hh = `${date.getHours()}`.padStart(2, "0")
  const mm = `${date.getMinutes()}`.padStart(2, "0")
  return `${hh}:${mm}`
}

/** 相对时间描述，例如“3 分钟前” */
export function relativeTime(ts: number): string {
  if (!ts) return "--"
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

/** 脱敏显示 API Key */
export function maskApiKey(key: string): string {
  const value = (key || "").trim()
  if (!value) return "未设置"
  if (value.length <= 12) return `${value.slice(0, 4)}••••`
  return `${value.slice(0, 7)}••••••${value.slice(-4)}`
}
