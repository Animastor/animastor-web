import { describe, it, expect } from 'vitest';
import { resolveStreamOutcome } from './streamOutcome';

describe('resolveStreamOutcome', () => {
  it('error frame with code busy → failed/busy', () => {
    const out = resolveStreamOutcome({
      donePayload: null,
      errorFrame: { code: 'busy', error: 'all slots busy' },
      streamedText: '',
    });
    expect(out).toEqual({ kind: 'failed', code: 'busy', message: 'all slots busy' });
  });

  it('error frame after deltas → failed (partial text does not make it a success)', () => {
    const out = resolveStreamOutcome({
      donePayload: null,
      errorFrame: { error: 'upstream died' },
      streamedText: 'Hello, here is the first part',
    });
    expect(out).toEqual({ kind: 'failed', code: undefined, message: 'upstream died' });
  });

  it('error frame wins even if a done payload was also seen', () => {
    const out = resolveStreamOutcome({
      donePayload: { reply: 'x' },
      errorFrame: { code: 'timeout', message: 'took too long' },
      streamedText: 'x',
    });
    expect(out).toEqual({ kind: 'failed', code: 'timeout', message: 'took too long' });
  });

  it('only done → done with the payload', () => {
    const payload = { reply: 'ok', patches_applied: 0 };
    const out = resolveStreamOutcome({ donePayload: payload, errorFrame: null, streamedText: 'ok' });
    expect(out).toEqual({ kind: 'done', res: payload });
  });

  it('EOF without done and without error → done with null (unchanged behaviour)', () => {
    const out = resolveStreamOutcome({ donePayload: null, errorFrame: null, streamedText: '' });
    expect(out).toEqual({ kind: 'done', res: null });
  });
});
