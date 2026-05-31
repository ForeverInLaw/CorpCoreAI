import 'dotenv/config'
import { bot } from '../lib/bot'

async function main() {
  console.log('Starting bot...')

  await bot.api.deleteWebhook({ drop_pending_updates: true })

  await bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} started!`)
    },
  })
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...')
  bot.stop()
})
process.on('SIGINT', () => {
  console.log('SIGINT received, stopping bot...')
  bot.stop()
})

main().catch((err) => {
  console.error('Error starting bot:', err)
  process.exit(1)
})
