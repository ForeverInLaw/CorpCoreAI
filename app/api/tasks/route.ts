import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'

export async function GET(request: Request) {
    const initData = request.headers.get('Authorization')

    if (!initData) {
        return NextResponse.json({ error: 'Authorization header missing' }, { status: 401 })
    }

    const user = validateTelegramWebAppData(initData)

    if (!user) {
        return NextResponse.json({ error: 'Invalid initData' }, { status: 403 })
    }

    const userId = user.user?.id

    if (!userId) {
        return NextResponse.json({ error: 'User ID missing in initData' }, { status: 400 })
    }

    const numericUserId = Number(userId)

    if (Number.isNaN(numericUserId)) {
        return NextResponse.json({ error: 'Invalid user ID format' }, { status: 400 })
    }

    if (!isWhitelistedTelegramId(numericUserId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    try {
        const telegramUser = await ensureTelegramUser({
            id: numericUserId,
            name: user.user?.first_name,
        })

        const isManager = telegramUser.role === 'MANAGER'

        const tasks = await prisma.task.findMany({
            where: isManager
                ? undefined
                : {
                    OR: [
                        { assigneeId: BigInt(userId) },
                        { creatorId: BigInt(userId) }
                    ]
                },
            include: {
                assignee: true,
                creator: true,
                attachments: true,
                history: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    include: {
                        actor: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' }
        })

        const serializedTasks = tasks.map((task) => ({
            id: task.id.toString(),
            title: task.title,
            description: task.description,
            status: task.status,
            deadline: task.deadline ? task.deadline.toISOString() : null,
            subtasks: task.subtasks as string[] | null,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
            creatorId: task.creatorId.toString(),
            creatorName: task.creator?.name ?? null,
            assigneeId: task.assigneeId?.toString() ?? null,
            assigneeName: task.assignee?.name ?? null,
            overdueReason: task.overdueReason ?? null,
            attachments: task.attachments.map((attachment) => ({
                id: attachment.id.toString(),
                url: attachment.url,
                type: attachment.type,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                createdAt: attachment.createdAt.toISOString(),
            })),
            history: task.history.map((entry) => ({
                id: entry.id.toString(),
                type: entry.type,
                details: entry.details,
                createdAt: entry.createdAt.toISOString(),
                actorId: entry.actorId ? entry.actorId.toString() : null,
                actorName: entry.actor?.name ?? (entry.actorId ? `ID ${entry.actorId.toString()}` : null),
            })),
        }))

        const employees = isManager
            ? await prisma.user.findMany({
                where: { role: 'EMPLOYEE' },
                select: { id: true, name: true },
                orderBy: [{ name: 'asc' }]
            })
            : []

        return NextResponse.json({
            tasks: serializedTasks,
            user: {
                id: telegramUser.id.toString(),
                role: telegramUser.role,
                name: telegramUser.name,
            },
            employees: employees.map((employee) => ({
                id: employee.id.toString(),
                name: employee.name ?? `ID ${employee.id.toString()}`,
            })),
        })
    } catch (error) {
        console.error('Failed to fetch tasks:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
