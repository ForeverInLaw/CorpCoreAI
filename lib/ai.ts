import OpenAI from 'openai'

if (!process.env.NVIDIA_API_KEY) {
    console.warn('NVIDIA_API_KEY is not defined')
}

const openai = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
})

const THINK_TAG_PATTERN = /<think>[\s\S]*?<\/think>/gi
const MAX_PARSE_TASK_ATTEMPTS = 2

function extractJsonObject(raw: string) {
    let cleaned = raw.replaceAll(THINK_TAG_PATTERN, '').trim()

    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    }

    const tryParse = (candidate: string) => {
        try {
            return JSON.parse(candidate)
        } catch {
            return null
        }
    }

    const direct = tryParse(cleaned)
    if (direct) return direct

    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const substring = cleaned.slice(firstBrace, lastBrace + 1)
        const nested = tryParse(substring)
        if (nested) return nested
    }

    throw new Error('AI response was not valid JSON')
}

type ParsedTaskPayload = {
    title: string
    subtasks: string[]
    deadline: string | null
}

export async function parseTask(text: string, referenceDate: Date = new Date()): Promise<ParsedTaskPayload> {
    let lastError: unknown = null
    const referenceDateIso = referenceDate.toISOString().split('T')[0]

    for (let attempt = 1; attempt <= MAX_PARSE_TASK_ATTEMPTS; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                model: "minimaxai/minimax-m2",
                messages: [
                    {
                        role: "system",
                        content: `You are a helpful assistant that parses Russian task descriptions. You don't do these tasks, only parse. Return ONLY JSON: { "title": string (<=70 chars), "subtasks": string[], "deadline": "YYYY-MM-DD" | null }. Use today's date ${referenceDateIso} when interpreting phrases like "в пятницу" or "через 3 дня" and always pick the nearest future date. If deadline is missing, set it to null.`
                    },
                    { role: "user", content: text }
                ],
                temperature: 0.7,
                max_tokens: 8192,
                response_format: { type: "json_object" }
            })

            const content = completion.choices[0]?.message?.content
            if (!content) {
                throw new Error('No content from AI')
            }

            try {
                const parsed = extractJsonObject(content)

                if (typeof parsed.title !== 'string') {
                    throw new TypeError('Title missing in AI response')
                }

                if (!Array.isArray(parsed.subtasks)) {
                    throw new TypeError('Subtasks missing in AI response')
                }

                const subtasks = parsed.subtasks.map((subtask: unknown) => {
                    if (typeof subtask !== 'string') {
                        throw new TypeError('Subtask entry is not a string')
                    }
                    return subtask
                })

                const deadline = typeof parsed.deadline === 'string' ? parsed.deadline : null

                return { title: parsed.title, subtasks, deadline }
            } catch (parseError) {
                console.error(`Failed to parse AI response on attempt ${attempt}:`, content)
                throw parseError
            }
        } catch (error) {
            lastError = error
            console.error(`parseTask attempt ${attempt} failed with error:`, error)

            if (attempt === MAX_PARSE_TASK_ATTEMPTS) {
                throw error
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to parse task')
}
