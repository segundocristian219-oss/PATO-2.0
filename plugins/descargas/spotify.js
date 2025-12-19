"use strict";

import axios from "axios";

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const MAX_TIMEOUT = 30000;

const pendingSPOTIFY = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

async function getSpotifyMp3(input) {
  const endpoint = `${API_BASE}/spotify`;

  const isUrl = /spotify\.com/i.test(input);
  const body = isUrl ? { url: input } : { query: input };

  const { data, status } = await axios.post(
    endpoint,
    body,
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true
    }
  );

  let res = data;
  if (typeof res === "string") {
    try { res = JSON.parse(res.trim()); } catch { throw new Error("Respuesta inválida del servidor"); }
  }

  if (!(res?.status === true || res?.status === "true")) {
    throw new Error(res?.message || res?.error || `HTTP ${status}`);
  }

  const result = res.result || {};
  if (!result?.media?.audio) throw new Error("No se encontró el audio");

  return {
    mp3Url: result.media.audio,
    title: result.title || "Spotify Track",
    artist: result.artist || "Desconocido",
    image: result.image || result.thumbnail || null
  };
}

function safeBaseFromTitle(title) {
  return String(title || "spotify")
    .slice(0, 70)
    .replace(/[^A-Za-z0-9_.-]+/g, "_");
}

async function sendAudio(conn, job, asDocument, triggerMsg) {
  const { chatId, mp3Url, title, artist, previewKey, quotedBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎵");
    await react(conn, chatId, previewKey, "⏳");

    const caption = asDocument ? undefined : `${title}\npor ${artist}`;

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "audio"]: { url: mp3Url },
        mimetype: "audio/mpeg",
        fileName: asDocument ? `${safeBaseFromTitle(title)} - ${artist}.mp3` : undefined,
        caption
      },
      { quoted: quotedBase || triggerMsg }
    );

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  }
}

const handler = async (m, { conn, args, usedPrefix }) => {
  const chatId = m.key.remoteJid;
  const text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text: `✳️ Usa:\n${usedPrefix}sp <canción o URL>\n\nEjemplo:\n${usedPrefix}sp bad bunny tití me preguntó`
      },
      { quoted: m }
    );
  }

  try {
    await react(conn, chatId, m.key, "⏱️");

    const { mp3Url, title, artist, image } = await getSpotifyMp3(text);

    if (image) {
      await conn.sendMessage(
        chatId,
        {
          image: { url: image },
          caption:
`🎵 *Spotify*

✦ *Título:* ${title}
✦ *Artista:* ${artist}`
        },
        { quoted: m }
      );
    }

    const caption =
`🎵 Spotify — opciones

👍 Enviar audio
❤️ Enviar como documento
— o responde: 1 = audio · 2 = documento

✦ ${title}
✦ por ${artist}`;

    const preview = await conn.sendMessage(chatId, { text: caption }, { quoted: m });

    pendingSPOTIFY[preview.key.id] = {
      chatId,
      mp3Url,
      title,
      artist,
      quotedBase: m,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false
    };

    await react(conn, chatId, m.key, "✅");

    if (!conn._spotifyListener) {
      conn._spotifyListener = true;

      conn.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
          try {
            for (const k of Object.keys(pendingSPOTIFY)) {
              if (Date.now() - pendingSPOTIFY[k].createdAt > 15 * 60 * 1000) {
                delete pendingSPOTIFY[k];
              }
            }

            if (msg.message?.reactionMessage) {
              const { key, text: emoji } = msg.message.reactionMessage;
              const job = pendingSPOTIFY[key.id];
              if (!job || job.processing) continue;
              if (job.chatId !== msg.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              job.processing = true;
              await sendAudio(conn, job, emoji === "❤️", msg);
              delete pendingSPOTIFY[key.id];
              continue;
            }

            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const body =
              (msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text ||
               "").trim();

            if (replyTo && pendingSPOTIFY[replyTo]) {
              const job = pendingSPOTIFY[replyTo];
              if (job.processing) continue;
              if (job.chatId !== msg.key.remoteJid) continue;
              if (body !== "1" && body !== "2") continue;

              job.processing = true;
              await sendAudio(conn, job, body === "2", msg);
              delete pendingSPOTIFY[replyTo];
            }
          } catch {}
        }
      });
    }

  } catch (e) {
    await react(conn, chatId, m.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: "❌ Error al procesar Spotify." },
      { quoted: m }
    );
  }
};

handler.command = ["spotify", "sp"];
handler.help = ["spotify <canción o url>"];
handler.tags = ["descargas"];

export default handler;