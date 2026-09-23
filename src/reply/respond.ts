// The two ways a tool builds its reply. Either way, a failure becomes a tool error that
// the agent reads, never a thrown exception that ends the call.

/**
 * Run one Trello call and return its reply as a text block, trimmed by the shaper when
 * one is given. Compact JSON: indentation costs the agent context and tells it nothing.
 */
export async function json<T>(call: () => Promise<T>, shaper?: (value: T) => unknown) {
  try {
    const result = await call();
    const shaped = shaper ? shaper(result) : result;
    const text = typeof shaped === 'string' ? shaped : JSON.stringify(shaped);
    return { content: [{ type: 'text' as const, text }] };
  } catch (error) {
    return errorReply(error);
  }
}

/** Run a handler that builds its own reply, and turn anything it throws into a tool error. */
export async function safe<R>(handler: () => Promise<R>) {
  try {
    return await handler();
  } catch (error) {
    return errorReply(error);
  }
}

function errorReply(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
      },
    ],
    isError: true,
  };
}
