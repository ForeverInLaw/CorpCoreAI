import { validate, parse } from '@tma.js/init-data-node'

export function validateTelegramWebAppData(initData: string) {
  if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not defined')
  }

  try {
    validate(initData, process.env.BOT_TOKEN, {
      expiresIn: 3600, // 1 hour expiration
    })
    return parse(initData)
  } catch (e) {
    console.error('Validation failed:', e)
    return null
  }
}
