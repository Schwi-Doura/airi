/** Holds the NovelAI account slot until text or image generation completes. */
export async function runGeneration<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return navigator.locks.request('airi:novelai:text-generation', { signal }, operation)
}

/**
 * Shares one NovelAI generation slot across provider instances and same-origin windows.
 * Requires Web Locks. Consumers must read or cancel response bodies to release the slot.
 */
export function createGenerationFetch(fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): typeof fetch {
  return (input, init) => {
    const ready = Promise.withResolvers<Response>()
    const signal = init?.signal ?? undefined
    // Keep the account slot until the response body ends, rather than releasing it when headers arrive.
    void runGeneration(async () => {
      try {
        const response = await fetcher(input, init)
        if (!response.ok || !response.body) {
          ready.resolve(response)
          return
        }
        const reader = response.body.getReader()
        const finished = Promise.withResolvers<void>()
        const abort = () => {
          void reader.cancel(signal?.reason).then(() => finished.resolve(), () => finished.resolve())
        }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted)
          abort()
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const result = await reader.read()
              if (result.done) {
                finished.resolve()
                controller.close()
              }
              else {
                controller.enqueue(result.value)
              }
            }
            catch (cause) {
              finished.resolve()
              controller.error(cause)
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason)
            }
            finally {
              finished.resolve()
            }
          },
        })
        ready.resolve(new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }))
        try {
          await finished.promise
        }
        finally {
          signal?.removeEventListener('abort', abort)
          reader.releaseLock()
        }
      }
      catch (cause) {
        ready.reject(cause)
      }
    }, signal).catch(ready.reject)
    return ready.promise
  }
}
