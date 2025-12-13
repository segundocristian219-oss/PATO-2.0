const urlRegex = /\b((https?:\/\/|www\.)[^\s/$.?#].[^\s]*)/gi
const channelRegex = /whatsapp\.com\/channel\/([0-9A-Za-z]{20,24})/i

const allowedDomains = [
  'instagram.com',
  'www.instagram.com',
  'ig.me'
]

const shorteners = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'shorturl.at',
  'goo.gl',
  'rebrand.ly',
  'is.gd',
  'cutt.ly',
  'linktr.ee',
  'shrtco.de'
]

export async function before(m, { conn, isAdmin, isBotAdmin }) {
  if (!m || m.fromMe || m.isBaileys) return true
  if (m.key?.fromMe) return true
  if (m.sender === conn.user?.jid) return true
  if (!m.isGroup) return false

  const chat = global.db.data.chats[m.chat]
  if (!chat?.antiLink) return true
  if (isAdmin) return true
  if (!isBotAdmin) return true

  const body = (m.text || "").trim()
  if (!body) return true

  const links = body.match(urlRegex)
  const hasChannelLink = channelRegex.test(body)

  if (!links && !hasChannelLink) return true

  global.db.data.users[m.sender] ||= {}
  global.db.data.users[m.sender].antiLinkWarns ||= {}

  const warns = global.db.data.users[m.sender].antiLinkWarns
  warns[m.chat] ||= 0

  try {
    const inviteCode = await conn.groupInviteCode(m.chat)
    const groupLink = `https://chat.whatsapp.com/${inviteCode}`.toLowerCase()

    let blocked = false

    if (hasChannelLink) blocked = true

    if (links) {
      for (const link of links) {
        const lower = link.toLowerCase()
        if (lower.includes(groupLink)) continue
        if (allowedDomains.some(d => lower.includes(d))) continue
        if (shorteners.some(s => lower.includes(s)) || !allowedDomains.some(d => lower.includes(d))) {
          blocked = true
          break
        }
      }
    }

    if (!blocked) return true

    warns[m.chat] += 1

    await conn.sendMessage(m.chat, { delete: m.key }).catch(() => {})

    if (warns[m.chat] >= 3) {
      await conn.sendMessage(
        m.chat,
        {
          text: `🚫 @${m.sender.split('@')[0]} superó el límite de links (3/3)\n👢 Expulsado del grupo`,
          mentions: [m.sender]
        }
      ).catch(() => {})

      await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {})
      warns[m.chat] = 0
    } else {
      await conn.sendMessage(
        m.chat,
        {
          text:
            `⚠️ @${m.sender.split('@')[0]} no se permiten links\n` +
            `Advertencia ${warns[m.chat]}/3`,
          mentions: [m.sender]
        },
        { quoted: m }
      ).catch(() => {})
    }
  } catch (e) {
    console.error(e)
  }

  return true
}

let handler = async (m, { isAdmin, isOwner }) => {
  if (!m.isGroup) return
  if (!isAdmin && !isOwner) return

  const chat = global.db.data.chats[m.chat]
  const text = (m.text || '').toLowerCase().trim()

  if (text === '.on antilink') {
    chat.antiLink = true
    return m.reply('✅ AntiLink activado')
  }

  if (text === '.off antilink') {
    chat.antiLink = false
    return m.reply('❌ AntiLink desactivado')
  }

  return m.reply(
    '⚙️ AntiLink\n\n' +
    '.on antilink\n' +
    '.off antilink'
  )
}

handler.customPrefix = /^\.on antilink$|^\.off antilink$/i
handler.command = new RegExp()
handler.group = true
handler.admin = true

export default handler