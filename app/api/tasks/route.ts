import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTelegramWebAppData } from '@/lib/auth'

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

    const userId = user.user?.id.toString()

    if (!userId) {
        return NextResponse.json({ error: 'User ID missing in initData' }, { status: 400 })
    }

    try {
        const tasks = await prisma.task.findMany({
            where: {
                OR: [
                    { assigneeId: BigInt(userId) },
                    { creatorId: BigInt(userId) }
                ]
            },
            include: {
                assignee: true,
                creator: true
            },
            orderBy: { createdAt: 'desc' }
        })

        // Serialize BigInt
        const serializedTasks = tasks.map(task => serializeBigInts({
            ...task,
            id: task.id.toString(),
            creatorId: task.creatorId.toString(),
            assigneeId: task.assigneeId?.toString(),
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
        }))

        return NextResponse.json(serializedTasks)
    } catch (error) {
        console.error('Failed to fetch tasks:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
