import axios from 'axios';

// How many times a request is repeated after a temporary fault.
export const MAX_RETRIES = 3;

// 429, a 5xx, or no reply at all. Everything else is the caller's to resolve.
export function isTransient(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  // With no reply, ERR_BAD_RESPONSE means this side refused the reply, as a download over
  // the size limit. Asking again would only fetch the same bytes.
  if (status === undefined) return error.code !== 'ERR_BAD_RESPONSE';
  return status === 429 || status >= 500;
}

// A fault that may have come after Trello acted on the request.
export function isLostReply(error: unknown): boolean {
  return isTransient(error) && axios.isAxiosError(error) && error.response?.status !== 429;
}

export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return `no reply from Trello (${error.code ?? error.message})`;
    // Trello explains a refusal in plain text, or in the message field of a JSON body.
    const body = error.response.data as unknown;
    const reason =
      typeof body === 'string'
        ? body
        : typeof (body as { message?: unknown } | null)?.message === 'string'
          ? (body as { message: string }).message
          : '';
    return `Trello returned ${error.response.status}${reason ? `: ${reason}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}
