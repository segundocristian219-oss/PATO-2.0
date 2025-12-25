import { watchFile, unwatchFile } from 'fs'
import chalk from 'chalk'
import { fileURLToPath } from 'url'

global.owner = [
'217158512549931', 
'227045091090524',
'159606034665538', 
''
] 

global.mods = []
global.prems = []

global.emoji = '📎'
global.emoji2 = '🏞️'
global.namebot = '𝐏𝐀𝐓𝐎 𝐁𝐎𝐓'
global.botname = '𝐏𝐀𝐓𝐎 𝐁𝐎𝐓'
global.banner = 'https://cdn.russellxz.click/d479223a.jpeg'
global.packname = '𝐏𝐀𝐓𝐎 𝐁𝐎𝐓'
global.author = '𝖣𝖾𝗌𝖺𝗋𝗅𝗅𝖺𝖽𝗈 𝗉𝗈𝗋 𝐇𝐄𝐑𝐍𝐀𝐍𝐃𝐄𝐙'
global.sessions = '𝐏𝐀𝐓𝐎 𝐁𝐎𝐓'

global.APIs = {
sky: 'https://api-sky.ultraplus.click',
may: 'https://mayapi.ooguy.com'
}

global.APIKeys = {
sky: 'Angxlllll',
may: 'may-0595dca2'
}

const file = fileURLToPath(import.meta.url)
watchFile(file, () => {
unwatchFile(file)
console.log(chalk.redBright("Se actualizó el 'config.js'"))
import(`file://${file}?update=${Date.now()}`)
})