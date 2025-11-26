import OpenAI from 'openai'

if (!process.env.NVIDIA_API_KEY) {
    console.warn('NVIDIA_API_KEY is not defined')
}

const openai = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
})

const THINK_TAG_PATTERN = /<think>[\s\S]*?<\/think>/gi

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

export async function parseTask(text: string) {
    const completion = await openai.chat.completions.create({
        model: "minimaxai/minimax-m2",
        messages: [
            {
                role: "system",
                content: "You are a helpful assistant that parses task descriptions. Extract a short title (max 70 chars) and a list of subtasks from the user's text. Return JSON format: { \"title\": \"...\", \"subtasks\": [\"...\", \"...\"] }. If no subtasks are explicit, generate reasonable ones."
            },
            { role: "user", content: text }
        ],
        temperature: 0.7,
        max_tokens: 1024,
        response_format: { type: "json_object" }
    })

    const content = completion.choices[0]?.message?.content
    if (!content) throw new Error('No content from AI')

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

        return { title: parsed.title, subtasks }
    } catch (e) {
        console.error('Failed to parse AI response:', content)
        throw e
    }
}
