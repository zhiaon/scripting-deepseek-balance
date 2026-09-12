import { Script } from "scripting"

/**
 * DeepSeek 余额小组件 · 环境诊断脚本（单文件，直接粘贴运行即可）
 * 不 import Keychain / Storage / Dialog，全部用 typeof 保护，用来查清：
 *   1) 这几个模块到底存不存在（模块导出 vs 全局命名空间）
 *   2) 写进去 / 读回来是否成功（这就是「保存 Key 没反应」的根源）
 *   3) 网络是否通得到 api.deepseek.com
 * 结果会以系统弹窗展示，同时也写进 Scripting 的日志面板。
 */

declare const Keychain: any
declare const Storage: any
declare const Dialog: any
declare const Pasteboard: any

const PROBE_KEY = "diag.probe"

async function collect(): Promise<string[]> {
  const out: string[] = []
  const g: any = globalThis as any

  out.push(`环境：${Script.env} · 版本 ${Script.metadata?.version ?? "?"}`)
  out.push(`Keychain：typeof=${typeof Keychain} · globalThis=${g.Keychain == null ? "无" : "有"}`)
  out.push(`Storage：typeof=${typeof Storage} · globalThis=${g.Storage == null ? "无" : "有"}`)
  out.push(`Dialog：typeof=${typeof Dialog} · globalThis=${g.Dialog == null ? "无" : "有"}`)
  out.push(`Pasteboard：typeof=${typeof Pasteboard}`)

  // ---- Keychain ----
  try {
    const kc: any = typeof Keychain !== "undefined" ? Keychain : g.Keychain
    if (kc == null) {
      out.push("Keychain：模块不存在，跳过")
    } else {
      const wrote = kc.set(PROBE_KEY, "hello")
      out.push(`Keychain.set → ${String(wrote)}`)
      const read = kc.get(PROBE_KEY)
      out.push(`Keychain.get → ${String(read)}（期望 hello）`)
      if (typeof kc.remove === "function") kc.remove(PROBE_KEY)
    }
  } catch (error) {
    out.push(`Keychain 异常：${error instanceof Error ? error.message : error}`)
  }

  // ---- Storage ----
  try {
    const st: any = typeof Storage !== "undefined" ? Storage : g.Storage
    if (st == null) {
      out.push("Storage：模块不存在，跳过")
    } else {
      const wrote = st.set(PROBE_KEY, "hello-storage")
      out.push(`Storage.set → ${String(wrote)}`)
      const read = st.get(PROBE_KEY)
      out.push(`Storage.get → ${String(read)}（期望 hello-storage）`)
      if (typeof st.remove === "function") st.remove(PROBE_KEY)
    }
  } catch (error) {
    out.push(`Storage 异常：${error instanceof Error ? error.message : error}`)
  }

  // ---- 网络 ----
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer test-invalid-key" },
      timeout: 12,
    })
    out.push(`网络 → HTTP ${res.status}（401/403 = 网络正常、Key 无效；异常 = 网络有问题）`)
  } catch (error) {
    out.push(`网络异常：${error instanceof Error ? error.message : error}`)
  }

  return out
}

async function run() {
  let lines: string[] = []
  try {
    lines = await collect()
  } catch (error) {
    lines = [`诊断本身出错：${error instanceof Error ? error.message : error}`]
  }

  const text = lines.join("\n")
  console.log(`===== DeepSeek 诊断 =====\n${text}`)

  try {
    const dlg: any = typeof Dialog !== "undefined" ? Dialog : (globalThis as any).Dialog
    if (dlg != null && typeof dlg.alert === "function") {
      await dlg.alert({ title: "环境诊断结果", message: text })
    } else {
      console.log("Dialog 不可用，请查看日志面板")
    }
  } catch (error) {
    console.log(`弹窗失败：${error}`)
  }
}

run().then(() => {
  Script.exit()
})
