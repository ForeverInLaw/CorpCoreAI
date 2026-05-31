import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { execFile } from 'node:child_process'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const RIVA_HOST = 'grpc.nvcf.nvidia.com:443'
const RIVA_FUNCTION_ID =
  process.env.RIVA_WHISPER_FUNCTION_ID ??
  'b702f636-f60c-4a3d-a6f4-f3568c13bd7d'

let cachedClient: grpc.Client & {
  Recognize: (
    request: unknown,
    callback: (err: grpc.ServiceError | null, response?: unknown) => void,
  ) => void
} | null = null

function loadRivaClient() {
  const protoDir = join(process.cwd(), 'proto')
  const packageDef = protoLoader.loadSync('riva/riva_asr.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoDir],
  })

  const loaded = grpc.loadPackageDefinition(packageDef)
  const asrNs = loaded.nvidia as grpc.GrpcObject | undefined
  const rivaNs = asrNs?.riva as grpc.GrpcObject | undefined
  const asrService = rivaNs?.asr as grpc.GrpcObject | undefined
  const Ctor = asrService
    ?.RivaSpeechRecognition as
    | typeof grpc.Client
    | undefined

  if (!Ctor) {
    throw new Error('Failed to load RivaSpeechRecognition proto definition')
  }

  const tlsCreds = grpc.credentials.createSsl()

  const callCreds = grpc.credentials.createFromMetadataGenerator(
    (_params, cb) => {
      const meta = new grpc.Metadata()
      meta.set('function-id', RIVA_FUNCTION_ID)
      meta.set('authorization', `Bearer ${process.env.NVIDIA_API_KEY}`)
      cb(null, meta)
    },
  )

  const combined = grpc.credentials.combineChannelCredentials(
    tlsCreds,
    callCreds,
  )

  return new Ctor(RIVA_HOST, combined) as grpc.Client & {
    Recognize: (
      request: unknown,
      callback: (err: grpc.ServiceError | null, response?: unknown) => void,
    ) => void
  }
}

function getClient() {
  if (!cachedClient) {
    cachedClient = loadRivaClient()
  }
  return cachedClient
}

async function convertOggToWav(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.ogg$/i, '.wav')
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    outputPath,
  ])
  return outputPath
}

interface RecognizeResponse {
  results: Array<{
    alternatives: Array<{ transcript: string; confidence: number }>
  }>
}

export async function transcribeVoice(oggBuffer: Buffer): Promise<string> {
  const tmpOgg = join(
    tmpdir(),
    `voice-${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`,
  )
  let tmpWav: string | null = null

  try {
    await writeFile(tmpOgg, oggBuffer)
    tmpWav = await convertOggToWav(tmpOgg)
    const wavBuffer = await readFile(tmpWav)
    console.log(`[voice] wav converted: ${wavBuffer.length} bytes`)

    const client = getClient()
    const results = await new Promise<RecognizeResponse>((resolve, reject) => {
      client.Recognize(
        {
          config: {
            encoding: 'LINEAR_PCM',
            sample_rate_hertz: 16000,
            language_code: 'multi',
            enable_automatic_punctuation: true,
          },
          audio: wavBuffer,
        },
        (err, response) => {
          if (err) reject(err)
          else resolve(response as RecognizeResponse)
        },
      )
    })

    const transcript =
      results.results?.[0]?.alternatives?.[0]?.transcript ?? ''

    if (!transcript) {
      console.warn('[voice] empty transcript, gRPC response:', JSON.stringify(results))
    }

    return transcript
  } finally {
    await unlink(tmpOgg).catch(() => {})
    if (tmpWav) await unlink(tmpWav).catch(() => {})
  }
}
