import { Bot, Context } from 'grammy'
import { prisma } from '../db'
import { parseTask } from '../ai'

if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not defined')
}

export const bot = new Bot(process.env.BOT_TOKEN)

// Whitelist Middleware
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId) return

    const whitelist = (process.env.WHITELIST || '').split(',').map(id => Number(id.trim()))

    // Check if user is in DB or whitelist
    let user = await prisma.user.findUnique({ where: { id: userId } })

    if (!user) {
        if (whitelist.includes(userId)) {
            // Auto-register whitelisted user
            user = await prisma.user.create({
                data: {
                    id: userId,
                    name: ctx.from?.first_name,
                    role: 'EMPLOYEE' // Default role
                }
            })
        } else {
            await ctx.reply('Access denied. You are not on the whitelist.')
            return
        }
    }

    await next()
})

bot.command('start', (ctx) => ctx.reply('Welcome! Send me a task description.'))

bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    const userId = ctx.from.id

    await ctx.reply('Analyzing task...')

    try {
        const { title, subtasks } = await parseTask(text)

        const task = await prisma.task.create({
            data: {
                title,
                description: text,
                creatorId: userId,
                assigneeId: userId, // Self-assign by default
                subtasks: subtasks,
                status: 'IN_PROGRESS'
            }
        })

        await ctx.reply(`Task created!\n\n*${task.title}*\n\nSubtasks:\n${subtasks.map((s: string) => `- ${s}`).join('\n')}`, { parse_mode: 'Markdown' })
    } catch (error) {
        console.error(error)
        await ctx.reply('Failed to create task. Please try again.')
    }
})

bot.catch((err) => {
    console.error('Bot error:', err)
})
