import axios from "axios"
import yts from "yt-search"
import fs from "fs"
import path from "path"
import ffmpeg from "fluent-ffmpeg"
import { promisify } from "util"
import { pipeline } from "stream"
import crypto from "crypto"

const streamPipe = promisify(pipeline)

const TMP_DIR = path.join(process.cwd(), "tmp")
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const CACHE_FILE = path.join(TMP_DIR, "cache.json")
const SKY_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click"
const SKY_KEY = process.env.API_KEY || "Neveloopp"

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 3
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 99
const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT) || 60000
const MAX_RETRIES = 3
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7

let activeDownloads = 0
const downloadQueue = []
const downloadTasks = {}
let cache = loadCache()

/* ================= CACHE ================= */

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {}
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {}
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8") || "{}")
    const now = Date.now()

    for (const id of Object.keys(parsed)) {
      const item = parsed[id]
      if (!item?.timestamp || now - item.timestamp > CACHE_TTL) {
        delete parsed[id]
        continue
      }
      for (const k of Object.keys(item.files || {})) {
        if (!fs.existsSync(item.files[k])) delete item.files[k]
      }
    }

    saveCache()
    return parsed
  } catch {
    return {}
  }
}

function safeUnlink(file) {
  try {
    file && fs.existsSync(file) && fs.unlinkSync(file)
  } catch {}
}

function fileSizeMB(file) {
  try {
    return fs.statSync(file).size / (1024 * 1024)
  } catch {
    return 0
  }
}

/* ================= VALIDACIÓN ================= */

function readHeader(file, len = 16) {
  try {
    const fd = fs.openSync(file, "r")
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    fs.closeSync(fd)
    return buf
  } catch {
    return null
  }
}

function validCache(file, expectedSize = null) {
  if (!file || !fs.existsSync(file)) return false
  const size = fs.statSync(file).size
  if (size < 501024) return false
  if (expectedSize && size < expectedSize * 0.92) return false

  const header = readHeader(file)
  if (!header) return false
  const hex = header.toString("hex")

  if (file.endsWith(".mp3") && !(hex.startsWith("494433") || hex.startsWith("fff"))) return false
  if ((file.endsWith(".mp4") || file.endsWith(".m4a")) && !hex.includes("66747970")) return false

  return true
}

/* ================= QUEUE ================= */

async function queueDownload(task) {
  if (activeDownloads >= MAX_CONCURRENT)
    await new Promise(res => downloadQueue.push(res))

  activeDownloads++
  try {
    return await task()
  } finally {
    activeDownloads--
    downloadQueue.length && downloadQueue.shift()()
  }
}

/* ================= SKY API ================= */

async function getSkyApiUrl(videoUrl, format, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { data } = await axios.get(`${SKY_BASE}/api/download/yt.php`, {
        params: { url: videoUrl, format },
        headers: { Authorization: `Bearer ${SKY_KEY}` },
        timeout: 20000
      })

      const url =
        data?.data?.audio ||
        data?.data?.video ||
        data?.audio ||
        data?.video ||
        data?.url

      if (url?.startsWith("http")) return url
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 500 * (i + 1)))
  }
  return null
}

/* ================= DOWNLOAD ================= */

async function downloadWithProgress(url, file, signal) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT,
    signal
  })
  await streamPipe(res.data, fs.createWriteStream(file))
  return file
}

async function convertToMp3(input) {
  const out = input.replace(path.extname(input), ".mp3")
  await new Promise((res, rej) =>
    ffmpeg(input)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .on("end", res)
      .on("error", rej)
      .save(out)
  )
  safeUnlink(input)
  return out
}

function ensureTask(id) {
  if (!downloadTasks[id]) downloadTasks[id] = {}
  return downloadTasks[id]
}

async function startDownload(videoUrl, key, mediaUrl, retry = 0) {
  const tasks = ensureTask(videoUrl)
  if (tasks[key]?.status === "downloading") return tasks[key].promise
  if (tasks[key]?.status === "done") return tasks[key].file

  const ext = key.startsWith("audio") ? "mp3" : "mp4"
  const file = path.join(TMP_DIR, `${crypto.randomBytes(8).toString("hex")}_${key}.${ext}`)
  const controller = new AbortController()

  const info = {
    status: "downloading",
    file,
    promise: null,
    controller
  }

  info.promise = (async () => {
    try {
      await queueDownload(() => downloadWithProgress(mediaUrl, file, controller.signal))
      info.file = key.startsWith("audio") && ext !== "mp3" ? await convertToMp3(file) : file

      if (!validCache(info.file)) throw new Error("Archivo inválido")
      if (fileSizeMB(info.file) > MAX_FILE_MB) throw new Error("Archivo muy grande")

      info.status = "done"
      return info.file
    } catch (e) {
      safeUnlink(info.file)
      info.status = "error"
      if (retry < MAX_RETRIES) return startDownload(videoUrl, key, mediaUrl, retry + 1)
      throw e
    }
  })()

  tasks[key] = info
  return info.promise
}

/* ================= SEND ================= */

async function sendFile(conn, chat, file, title, isDoc, type, quoted) {
  if (!validCache(file))
    return conn.sendMessage(chat, { text: "❌ Archivo inválido." }, { quoted })

  const buffer = await fs.promises.readFile(file)
  const msg = isDoc
    ? { document: buffer }
    : type === "audio"
      ? { audio: buffer }
      : { video: buffer }

  await conn.sendMessage(
    chat,
    { ...msg, mimetype: type === "audio" ? "audio/mpeg" : "video/mp4", fileName: `${title}.${type === "audio" ? "mp3" : "mp4"}` },
    { quoted }
  )
}

/* ================= HANDLER ================= */

const handler = async (msg, { conn, text, command }) => {
  const pref = global.prefixes?.[0] || "."

  if (!text?.trim())
    return conn.sendMessage(
      msg.chat,
      { text: `✳️ Usa:\n${pref}play <término>` },
      { quoted: msg }
    )

  let res
  try {
    res = await yts.search(text)
  } catch {
    return conn.sendMessage(msg.chat, { text: "❌ Error al buscar." }, { quoted: msg })
  }

  const video = res.videos?.[0]
  if (!video)
    return conn.sendMessage(msg.chat, { text: "❌ Sin resultados." }, { quoted: msg })

  const { url, title, timestamp, views, author, thumbnail } = video

  const caption = `┏━[ *Angel bot 𝖬𝗎𝗌𝗂𝖼 🎧* ]━┓
┃⥤🎧 *Título:* ${title}
┃⥤⏱️ *Duración:* ${timestamp}
┃⥤👁️ *Vistas:* ${views.toLocaleString()}
┃⥤👤 *Autor:* ${author?.name || author}
┗━━━━━━━━━━━━━━━━┛

Reacciona:
👍 Audio
❤️ Video
📄 Audio Doc
📁 Video Doc`

  await conn.sendMessage(
    msg.chat,
    { image: { url: thumbnail }, caption },
    { quoted: msg }
  )
}

handler.help = ["𝖯𝗅𝖺𝗒 <texto>"]
handler.tags = ["𝖣𝖤𝖲𝖢𝖠𝖱𝖦𝖠𝖲"]
handler.command = ["play"]

export default handler