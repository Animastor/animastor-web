// streamOutcome — pure resolution of a finished /ai/chat/stream exchange.
// postChatStream resolves on EOF whether or not the backend sent an
// `event: error` frame, so the page cannot treat "the promise resolved" as
// success. The rule: an error frame always wins (even after partial deltas —
// the partial text stays visible, but the turn is failed); otherwise the turn
// is done with whatever the `done` payload was (null on a bare EOF, as before).

export interface StreamErrorFrame {
  code?: string;
  error?: string;
  message?: string;
}

export interface StreamOutcomeInput<T> {
  donePayload: T | null;
  errorFrame: StreamErrorFrame | null;
  // Partial text received before the terminal frame. It never changes the
  // outcome (a partial answer + error frame is still a failure); it is part
  // of the input so that rule is explicit at the call site.
  streamedText: string;
}

export type StreamOutcome<T> =
  | { kind: 'done'; res: T | null }
  | { kind: 'failed'; code: string | undefined; message: string };

export function resolveStreamOutcome<T>(input: StreamOutcomeInput<T>): StreamOutcome<T> {
  const frame = input.errorFrame;
  if (frame) {
    return { kind: 'failed', code: frame.code || undefined, message: frame.error || frame.message || '' };
  }
  return { kind: 'done', res: input.donePayload };
}
