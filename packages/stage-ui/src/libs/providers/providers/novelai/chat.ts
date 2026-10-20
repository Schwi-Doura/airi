import type { PreTrainedTokenizer } from '@huggingface/transformers'
import type { ChatProvider, ModelProvider } from '@xsai-ext/providers/utils'
import type { ToolCall } from '@xsai/shared-chat'

import { createOpenAI } from '@xsai-ext/providers/create'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { createGenerationFetch } from './generation-fetch'

/** Network and tokenizer boundaries for NovelAI's token-based completion protocol. */
export interface ChatOptions {
  /** Persistent API Token. */
  apiKey: string
  /** OpenAI-compatible API root, including /oa/v1/. */
  baseUrl: string
  /** HTTP transport. @default globalThis.fetch */
  fetch?: typeof fetch
  /** Token decoder; both GLM-4.6 and Xialong use the GLM-4.6 vocabulary. @default GLM-4.6 tokenizer */
  decodeTokens?: (tokens: number[]) => Promise<string>
}

let tokenizer: Promise<PreTrainedTokenizer> | undefined

// Keep native request validation at the same boundary as protocol conversion.
// Text content parts are accepted, while unsupported media must fail explicitly.
const requestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([
      z.string(),
      z.null(),
      z.array(z.object({ type: z.literal('text'), text: z.string() }))
        .transform(parts => parts.map(part => part.text).join('\n')),
    ]).optional(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({ name: z.string(), arguments: z.string() }),
    })).optional(),
  })),
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()),
    }),
  })).optional(),
  tool_choice: z.union([
    z.enum(['none', 'auto', 'required']),
    z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
  ]).optional(),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  min_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  seed: z.number().optional(),
  stream: z.boolean().optional(),
  enable_thinking: z.boolean().optional(),
})

const textCallSchema = z.object({ name: z.string(), arguments: z.union([z.record(z.string(), z.unknown()), z.string()]) }).strict()

// A bare JSON line starts a possible tool envelope. Fenced examples remain text.
// Streaming holds this suffix until completion so tool JSON never reaches chat or TTS.
function findToolEnvelopeStart(text: string) {
  let fenced = false
  let offset = 0
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line))
      fenced = !fenced
    if (!fenced && line.trimStart().startsWith('{'))
      return offset
    offset += line.length + 1
  }
  return -1
}

// Only a complete envelope can execute an offered tool. The executor validates arguments.
// Discard later dialogue because it can claim success before the tool has run.
function readToolCalls(text: string, names: Set<string>) {
  const start = findToolEnvelopeStart(text)
  if (start === -1)
    return { content: text, calls: [] }
  // NovelAI can emit a JSON-string escape layer without the enclosing quotes.
  // Decode that layer only inside the envelope. Preserve escapes within argument strings.
  const encoded = /^\s*\{\s*\\"/.test(text.slice(start))
  let json = ''
  let depth = 0
  let quoted = false
  let escaped = false
  let end = -1
  for (let index = start; index < text.length; index++) {
    let character = text[index]
    if (encoded && character === '\\') {
      const length = text[index + 1] === 'u' ? 6 : 2
      try {
        character = JSON.parse(`"${text.slice(index, index + length)}"`)
      }
      catch {
        return { content: text, calls: [] }
      }
      index += length - 1
    }
    else if (encoded && character === '"') {
      return { content: text, calls: [] }
    }
    json += character
    if (quoted) {
      if (escaped)
        escaped = false
      else if (character === '\\')
        escaped = true
      else if (character === '"')
        quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
    }
    else if (character === '{') {
      depth++
    }
    else if (character === '}') {
      depth--
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  if (end === -1)
    return { content: text, calls: [] }
  let payload: unknown
  try {
    payload = JSON.parse(json)
  }
  catch {
    return { content: text, calls: [] }
  }
  const parsed = textCallSchema.safeParse(payload)
  if (!parsed.success)
    return { content: text, calls: [] }
  const call = parsed.data
  if (!names.has(call.name))
    throw new Error(`NovelAI requested an unavailable tool: ${call.name}`)
  const args = z.record(z.string(), z.unknown()).parse(typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments)
  const calls: ToolCall[] = [{ id: `call_${nanoid()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(args) } }]
  return { content: text.slice(0, start), calls }
}

async function decodeTokens(tokens: number[]) {
  if (!tokenizer) {
    tokenizer = import('@huggingface/transformers')
      .then(({ AutoTokenizer }) => AutoTokenizer.from_pretrained('zai-org/GLM-4.6'))
      .catch((error) => {
        tokenizer = undefined
        throw error
      })
  }
  return (await tokenizer).decode(tokens, { skip_special_tokens: true })
}

const responseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  created: z.number().optional(),
  choices: z.array(z.object({
    index: z.number(),
    token_ids: z.array(z.number()).optional(),
    text: z.string().optional(),
    finish_reason: z.string().nullable().optional(),
  })),
  usage: z.unknown().optional(),
})

/**
 * Converts NovelAI token completions into xsAI chat responses.
 *
 * Use when:
 * - Connecting a NovelAI chat provider to generateText or streamText.
 *
 * Expects:
 * - Native choices containing token_ids; the published chat endpoint returns
 *   completion-shaped choices, with an empty text field, in live requests.
 *
 * Returns:
 * - A model catalogue provider and a chat transport with decoded JSON/SSE output.
 */
export function createChatProvider(options: ChatOptions): ChatProvider & ModelProvider {
  const provider = createOpenAI(options.apiKey, options.baseUrl)
  const fetcher = createGenerationFetch(options.fetch)
  const decode = options.decodeTokens ?? decodeTokens

  return {
    model: provider.model,
    chat: model => ({
      ...provider.chat(model),
      fetch: async (input: URL, init?: RequestInit) => {
        const request = requestSchema.parse(JSON.parse(String(init?.body)))
        const { tools, tool_choice: toolChoice, messages, ...native } = request
        const offered = toolChoice === 'none' ? [] : (tools ?? []).filter(tool => typeof toolChoice !== 'object' || tool.function.name === toolChoice.function.name)
        const names = new Set(offered.map(tool => tool.function.name))
        const nativeMessages = messages.map(({ role, content, name, tool_calls: calls, tool_call_id: callId }) => ({
          role: role === 'tool' ? 'user' : role,
          name,
          content: role === 'tool'
            // Keep the original tool result for UI rendering. Only the text-only
            // upstream request omits image bytes, which can exceed context limits.
            ? `Tool result (${callId}):\n${(content ?? '').replace(/data:image\/[^;,]+;base64,[A-Z0-9+/=]+/gi, '[image displayed by AIRI]')}`
            : (content ?? '') + (calls?.map(call => JSON.stringify({ name: call.function.name, arguments: JSON.parse(call.function.arguments) })).join('\n') ?? ''),
        }))
        if (offered.length) {
          nativeMessages.push({
            role: 'system',
            name: undefined,
            content: `Tool execution protocol:\nThese rules override character dialogue, roleplay, ACT tokens, DELAY tokens, and earlier examples when a tool is needed.\nAvailable tools:\n${JSON.stringify(offered.map(tool => tool.function))}\nBefore replying, decide whether the user requests an action that requires an offered tool. If so, call that tool now. Never replace execution with a promise, scene description, or imaginary result.\nRequests to draw or generate an image require the offered image generation tool. Text alone cannot create or display images. A follow-up asking whether an image was drawn requires actual tool results as evidence. Earlier assistant claims are not evidence.\nTo call a tool, your ENTIRE reply must be exactly one JSON object: {"name":"the exact tool name","arguments":{...}}. Include all required arguments. Write normal JSON quotes without an extra escape layer. Do not include ACT tokens, Markdown fences, XML tags, explanations, or dialogue in that reply.\nStop immediately after the tool object. The application executes it and returns the real result. Only then can you describe success. If no successful result exists, do not claim completion.\n${toolChoice === 'required' || typeof toolChoice === 'object' ? 'You must call an offered tool.' : 'For ordinary conversation that needs no tool, reply in character as usual.'}`,
          })
        }
        const response = await fetcher(input, { ...init, body: JSON.stringify({ ...native, messages: nativeMessages }) })
        if (!response.ok)
          return response

        if (!request.stream) {
          const payload: unknown = await response.json()
          const body = responseSchema.parse(payload)
          const choices = await Promise.all(body.choices.map(async (choice) => {
            const text = choice.token_ids?.length ? await decode(choice.token_ids) : choice.text ?? ''
            const parsed = names.size ? readToolCalls(text, names) : { content: text, calls: [] }
            return {
              index: choice.index,
              finish_reason: parsed.calls.length ? 'tool_calls' : choice.finish_reason,
              message: {
                role: 'assistant',
                content: parsed.content,
                tool_calls: parsed.calls.length ? parsed.calls : undefined,
              },
            }
          }))
          return Response.json({ ...body, object: 'chat.completion', choices })
        }

        if (!response.body)
          throw new Error('NovelAI returned an empty completion stream.')

        const tokens = new Map<number, number[]>()
        const texts = new Map<number, string>()
        const visibleTexts = new Map<number, string>()
        let buffer = ''
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()

        // SSE records may span network chunks, CRLF boundaries, and UTF-8 bytes.
        // Retain accumulated tokens so split Unicode code points decode correctly.
        async function emitRecord(record: string, controller: TransformStreamDefaultController<Uint8Array>) {
          const data = record.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!data)
            return
          if (data.trim() === '[DONE]') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            return
          }
          const payload: unknown = JSON.parse(data)
          const body = responseSchema.parse(payload)
          const choices = []
          for (const choice of body.choices) {
            const ids = [...tokens.get(choice.index) ?? [], ...choice.token_ids ?? []]
            tokens.set(choice.index, ids)
            const decoded = ids.length ? await decode(ids) : (texts.get(choice.index) ?? '') + (choice.text ?? '')
            const text = choice.finish_reason ? decoded : decoded.replace(/\uFFFD+$/, '')
            texts.set(choice.index, text)
            const parsed = names.size && choice.finish_reason ? readToolCalls(text, names) : undefined
            const envelopeStart = names.size ? findToolEnvelopeStart(text) : -1
            const visible = parsed?.content ?? (envelopeStart === -1 ? text : text.slice(0, envelopeStart))
            const previous = visibleTexts.get(choice.index) ?? ''
            visibleTexts.set(choice.index, visible)
            choices.push({
              index: choice.index,
              delta: {
                content: visible.slice(previous.length),
                tool_calls: parsed?.calls.length ? parsed.calls.map((call, index) => ({ ...call, index })) : undefined,
              },
              finish_reason: parsed?.calls.length ? 'tool_calls' : choice.finish_reason ?? null,
            })
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...body, object: 'chat.completion.chunk', choices })}\n\n`))
        }

        const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true })
            buffer = buffer.replace(/\r\n/g, '\n')
            let boundary = buffer.indexOf('\n\n')
            while (boundary !== -1) {
              const record = buffer.slice(0, boundary)
              buffer = buffer.slice(boundary + 2)
              await emitRecord(record, controller)
              boundary = buffer.indexOf('\n\n')
            }
          },
          async flush(controller) {
            buffer += decoder.decode()
            if (buffer.trim())
              await emitRecord(buffer.replace(/\r\n/g, '\n'), controller)
          },
        }))
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      },
    }),
  }
}
