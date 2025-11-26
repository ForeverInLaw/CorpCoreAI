import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'
import { ensureTelegramUser, isWhitelistedTelegramId } from '@/lib/users'

function serializeBigInts<T>(input: T): T {
    if (typeof input === 'bigint') {
        return input.toString() as T
    }

    if (Array.isArray(input)) {
        return input.map(item => serializeBigInts(item)) as T
    }

    if (input !== null && typeof input === 'object') {
        return Object.entries(input).reduce((acc, [key, value]) => {
            acc[key as keyof T] = serializeBigInts(value)
            return acc
        }, {} as Record<keyof T, T[keyof T]>) as T
    }

    return input
}

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
            },
            orderBy: { createdAt: 'desc' }
        })

        const serializedTasks = tasks.map(task => serializeBigInts({
            ...task,
            id: task.id.toString(),
            creatorId: task.creatorId.toString(),
            assigneeId: task.assigneeId?.toString(),
            assigneeName: task.assignee?.name ?? null,
            creatorName: task.creator?.name ?? null,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
            deadline: task.deadline ? task.deadline.toISOString() : null,
            attachments: task.attachments.map((attachment) => ({
                id: attachment.id.toString(),
                url: attachment.url,
                type: attachment.type,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                createdAt: attachment.createdAt.toISOString(),
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
