import 'dotenv/config'
import { bot } from '../lib/bot'

async function main() {
    console.log('Starting bot...')
    await bot.start({
        onStart: (botInfo) => {
            console.log(`Bot @${botInfo.username} started!`)
        },
    })
}

main().catch((err) => {
    console.error('Error starting bot:', err)
    process.exit(1)
})
