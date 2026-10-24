import { describe, expect, it } from 'vitest';
import { followUpMessage } from '../src/integrations/messaging';

describe('follow-up messages', () => {
  it('names the clinic and date without a prescription', () => {
    expect(followUpMessage('Dignity Clinic', '2026-10-27')).toBe(
      'Dignity Clinic: a follow-up visit is due on 2026-10-27. Open the secure link from the clinic for details. This message does not include diagnosis or medicines.',
    );
  });
});
