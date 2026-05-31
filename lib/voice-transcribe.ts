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

let cachedClient: InstanceType<
  ReturnType<typeof loadRivaClient>
> | null = null

function loadRivaClient() {
  const protoDir = join(process.cwd(), 'proto')
  const packageDef = protoLoader.loadSync('riva/proto/riva_asr.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoDir],
  })

  const proto = grpc.loadPackageDefinition(packageDef).nvidia.riva.asr as {
    RivaSpeechRecognition: new (
      address: string,
      credentials: grpc.ChannelCredentials,
    ) => InstanceType<typeof grpc.Client>
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

  return new proto.RivaSpeechRecognition(RIVA_HOST, combined)
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
    '-sample_fmt',
    's16',
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
  const tmpOgg = join(tmpdir(), `voice-${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`)
  let tmpWav: string | null = null

  try {
    await writeFile(tmpOgg, oggBuffer)
    tmpWav = await convertOggToWav(tmpOgg)
    const wavBuffer = await readFile(tmpWav)

    const client = getClient()
    const results = await new Promise<RecognizeResponse>((resolve, reject) => {
      client.Recognize(
        {
          config: {
            encoding: 'LINEAR_PCM',
            sample_rate_hertz: 16000,
            language_code: 'ru',
            enable_automatic_punctuation: true,
          },
          audio: wavBuffer,
        },
        (err: grpc.ServiceError | null, response: RecognizeResponse) => {
          if (err) reject(err)
          else resolve(response)
        },
      )
    })

    const transcript =
      results.results?.[0]?.alternatives?.[0]?.transcript ?? ''

    return transcript
  } finally {
    await unlink(tmpOgg).catch(() => {})
    if (tmpWav) await unlink(tmpWav).catch(() => {})
  }
}
