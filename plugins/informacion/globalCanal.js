import fs from 'fs'
import path from 'path'

export async function before(m, { conn }) {
  try {
    const nombreBot = global.namebot || '𝐒𝐇𝐀𝐃𝐎𝐖 𝐁𝐎𝐓'
    const bannerFinal = 'https://cdn.russellxz.click/45ad2c2a.jpeg'

    const canales = [global.idcanal, global.idcanal2].filter(Boolean)
    const newsletterJidRandom = canales.length
      ? canales[Math.floor(Math.random() * canales.length)]
      : null

    global.rcanal = {
      contextInfo: {
        isForwarded: true,
        forwardingScore: 1,
        ...(newsletterJidRandom && {
          forwardedNewsletterMessageInfo: {
            newsletterJid: newsletterJidRandom,
            serverMessageId: 100,
            newsletterName: global.namecanal
          }
        }),
        externalAdReply: {
          title: nombreBot,
          body: global.author,
          thumbnailUrl: bannerFinal,
          sourceUrl: null,
          mediaType: 1,
          renderLargerThumbnail: false
        }
      }
    }
  } catch (e) {
    console.log('Error al generar rcanal:', e)
  }
}