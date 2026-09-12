import { Keychain, Storage } from "scripting"

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
  const saved = Storage.get<Partial<Config>>(CONFIG_KEY) ?? {}
  return { ...DEFAULT_CONFIG, ...saved }
}

export function saveConfig(config: Config): boolean {
  return Storage.set(CONFIG_KEY, config)
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

/* ------------------------------ API Key ----------------------------- */

/**
 * 凭据存储：优先 iOS Keychain；若 Keychain 不可用（部分环境会抛错或返回 false），
 * 自动退回脚本私有 Storage，保证一定存得进去。两条路径都不向外抛异常。
 */

const STORAGE_KEY_ITEM = "deepseek.api_key.storage"

export type SaveKeyResult = {
  ok: boolean
  backend: "keychain" | "storage" | "none"
  error: string
}

let keychainError = ""

export function getKeychainError(): string {
  return keychainError
}

function keychainGet(): string {
  try {
    const value = Keychain.get(API_KEY_ITEM)
    if (typeof value === "string") {
      keychainError = ""
      return value.trim()
    }
    keychainError = "Keychain.get 返回空"
    return ""
  } catch (error) {
    keychainError = error instanceof Error ? error.message : `${error}`
    return ""
  }
}

function storageGet(): string {
  try {
    const value = Storage.get<string>(STORAGE_KEY_ITEM)
    return typeof value === "string" ? value.trim() : ""
  } catch (error) {
    return ""
  }
}

export function getApiKey(): string {
  const fromKeychain = keychainGet()
  if (fromKeychain.length > 0) return fromKeychain
  return storageGet()
}

/** 当前 Key 存在哪里（用于设置页展示） */
export function apiKeyBackend(): "keychain" | "storage" | "none" {
  if (keychainGet().length > 0) return "keychain"
  if (storageGet().length > 0) return "storage"
  return "none"
}

export function saveApiKey(key: string): SaveKeyResult {
  const value = key.trim()
  if (value.length === 0) {
    return { ok: false, backend: "none", error: "内容为空" }
  }

  let error = ""
  try {
    if (Keychain.set(API_KEY_ITEM, value)) {
      keychainError = ""
      try {
        Storage.remove(STORAGE_KEY_ITEM)
      } catch (e) {
        // 忽略
      }
      return { ok: true, backend: "keychain", error: "" }
    }
    error = "Keychain.set 返回 false"
    keychainError = error
  } catch (e) {
    error = e instanceof Error ? e.message : `${e}`
    keychainError = error
  }

  try {
    if (Storage.set(STORAGE_KEY_ITEM, value)) {
      return { ok: true, backend: "storage", error }
    }
    error = `${error} / Storage.set 返回 false`
  } catch (e) {
    error = `${error} / ${e}`
  }

  return { ok: false, backend: "none", error }
}

/** 兼容旧调用：只关心成功与否 */
export function setApiKey(key: string): boolean {
  return saveApiKey(key).ok
}

export function clearApiKey(): boolean {
  let ok = false
  try {
    ok = Keychain.remove(API_KEY_ITEM)
  } catch (e) {
    ok = false
  }
  try {
    Storage.remove(STORAGE_KEY_ITEM)
    ok = true
  } catch (e) {
    // 忽略
  }
  return ok
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0
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
  const cache = Storage.get<Cache>(CACHE_KEY)
  if (cache == null || !Array.isArray(cache.infos)) return null
  return cache
}

export function saveCache(cache: Cache): boolean {
  return Storage.set(CACHE_KEY, cache)
}

export function clearCache(): void {
  Storage.remove(CACHE_KEY)
  Storage.remove(HISTORY_KEY)
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
  const history = Storage.get<History>(HISTORY_KEY) ?? {}
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

  Storage.set(HISTORY_KEY, history)
  return history
}

export function loadHistory(): History {
  return Storage.get<History>(HISTORY_KEY) ?? {}
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
