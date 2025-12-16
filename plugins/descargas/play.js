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
const MAX_CONCURRENT = 3
const MAX_FILE_MB = 99
const DOWNLOAD_TIMEOUT = 60000
const MAX_RETRIES = 3
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7

let activeDownloads = 0
const downloadQueue = []
const downloadTasks = {}
let cache = loadCache()

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8") || "{}")
      const now = Date.now()
      for (const id in parsed) {
        if (now - parsed[id].timestamp > CACHE_TTL) delete parsed[id]
      }
      return parsed
    }
  } catch {}
  return {}
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {}
}

function safeUnlink(f) {
  try { f && fs.existsSync(f) && fs.unlinkSync(f) } catch {}
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function queueDownload(task) {
  if (activeDownloads >= MAX_CONCURRENT)
    await new Promise(res => downloadQueue.push(res))
  activeDownloads++
  try {
    return await task()
  } finally {
    activeDownloads--
    downloadQueue.shift()?.()
  }
}

async function getSkyApiUrl(url, format) {
  for (let i = 0; i < 3; i++) {
    try {
      const { data } = await axios.get(`${SKY_BASE}/api/download/yt.php`, {
        params: { url, format },
        headers: { Authorization: `Bearer ${SKY_KEY}` },
        timeout: 20000
      })
      const link =
        data?.data?.audio ||
        data?.data?.video ||
        data?.audio ||
        data?.video
      if (link?.startsWith("http")) return link
    } catch {}
    await wait(500)
  }
  return null
}

async function downloadFile(url, file) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT
  })
  await streamPipe(res.data, fs.createWriteStream(file))
  return file
}

async function convertMp3(input) {
  const out = input.replace(path.extname(input), ".mp3")
  await new Promise((res, rej) =>
    ffmpeg(input)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .save(out)
      .on("end", res)
      .on("error", rej)
  )
  safeUnlink(input)
  return out
}

async function startDownload(videoUrl, key, mediaUrl) {
  const ext = key.startsWith("audio") ? "mp3" : "mp4"
  const file = path.join(
    TMP_DIR,
    `${crypto.randomBytes(8).toString("hex")}_${key}.${ext}`
  )

  return queueDownload(async () => {
    await downloadFile(mediaUrl, file)
    if (key.startsWith("audio") && !file.endsWith(".mp3"))
      return await convertMp3(file)
    return file
  })
}

async function sendFile(conn, chatId, file, title, isDoc, type, quoted) {
  const buffer = await fs.promises.readFile(file)
  const msg = isDoc
    ? { document: buffer }
    : type === "audio"
    ? { audio: buffer }
    : { video: buffer }

  await conn.sendMessage(
    chatId,
    {
      ...msg,
      mimetype: type === "audio" ? "audio/mpeg" : "video/mp4",
      fileName: `${title}.${type === "audio" ? "mp3" : "mp4"}`
    },
    { quoted }
  )
}

const pending = {}

function pendingAdd(id, data) {
  pending[id] = data
  setTimeout(() => delete pending[id], 10 * 60 * 1000)
}
function pendingGet(id) {
  return pending[id]
}

const handler = async (msg, { conn, text, command }) => {
  const pref = global.prefixes?.[0] || "."

  if (!text)
    return conn.sendMessage(
      msg.chat,
      { text: `✳️ Usa:\n${pref}play <texto>` },
      { quoted: msg }
    )

  try {
    await conn.sendMessage(msg.chat, {
      react: { text: "🕒", key: msg.key }
    })
  } catch {}

  const res = await yts.search(text)
  const video = res.videos[0]
  if (!video)
    return conn.sendMessage(msg.chat, { text: "❌ Sin resultados." }, { quoted: msg })

  const caption = `┏━[ *Angel Bot Music 🎧* ]━┓
┃🎧 *Título:* ${video.title}
┃⏱️ *Duración:* ${video.timestamp}
┃👁️ *Vistas:* ${video.views.toLocaleString()}
┃👤 *Autor:* ${video.author.name}
┗━━━━━━━━━━━━━━━━┛

📥 *Reacciona para descargar*
👍 Audio MP3
❤️ Video MP4
📄 Audio Documento
📁 Video Documento`

  const preview = await conn.sendMessage(
    msg.chat,
    { image: { url: video.thumbnail }, caption },
    { quoted: msg }
  )

  pendingAdd(preview.key.id, {
    chatId: msg.chat,
    videoUrl: video.url,
    title: video.title,
    sender: msg.sender,
    quoted: msg
  })

  conn.ev.on("messages.upsert", async ev => {
    for (const m of ev.messages) {
      const react = m.message?.reactionMessage
      if (!react) continue

      const job = pendingGet(react.key.id)
      if (!job || react.sender !== job.sender) continue

      const map = {
        "👍": ["audio", false],
        "❤️": ["video", false],
        "📄": ["audio", true],
        "📁": ["video", true]
      }
      if (!map[react.text]) continue

      const [type, isDoc] = map[react.text]

      await conn.sendMessage(
        job.chatId,
        { text: `⏳ Descargando ${type === "audio" ? "Audio" : "Video"}...` },
        { quoted: job.quoted }
      )

      const url = await getSkyApiUrl(job.videoUrl, type)
      const file = await startDownload(job.videoUrl, type, url)

      await sendFile(conn, job.chatId, file, job.title, isDoc, type, job.quoted)

      try {
        await conn.sendMessage(job.chatId, {
          react: { text: "✅", key: job.quoted.key }
        })
      } catch {}
    }
  })
}

handler.help = ["play <texto>"]
handler.tags = ["descargas"]
handler.command = ["play"]

export default handler