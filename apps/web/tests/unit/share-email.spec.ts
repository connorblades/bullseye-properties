import { describe, expect, it } from 'vitest';
import { buildShareEmail } from '@/server/email/share-template';

const base = {
  url: 'https://os.bullseyeproperties.co.uk/o/SEC',
  dealAddress: '23 Acacia Avenue, Sheffield',
  partnerName: 'Connor Blades',
};

describe('buildShareEmail', () => {
  it('uses an outline subject and links the url for outline kind', () => {
    const e = buildShareEmail({ ...base, kind: 'outline', recipientName: 'Sarah', expiresAt: '2026-09-28T00:00:00Z' });
    expect(e.subject).toContain('outline');
    expect(e.subject).toContain('23 Acacia Avenue');
    expect(e.html).toContain('href="https://os.bullseyeproperties.co.uk/o/SEC"');
    expect(e.text).toContain('https://os.bullseyeproperties.co.uk/o/SEC');
    expect(e.html).toContain('Hi Sarah,');
  });

  it('uses a report subject for report kind', () => {
    const e = buildShareEmail({ ...base, kind: 'report' });
    expect(e.subject).toContain('Standard Deal Report');
    expect(e.html).toContain('Hi there,'); // no recipient name -> generic greeting
  });

  it('states the expiry when given and the no-expiry case otherwise', () => {
    const withExp = buildShareEmail({ ...base, kind: 'outline', expiresAt: '2026-09-28T00:00:00Z' });
    expect(withExp.text).toMatch(/valid until/);
    const noExp = buildShareEmail({ ...base, kind: 'outline', expiresAt: null });
    expect(noExp.text).toMatch(/does not expire/);
  });

  it('escapes html in caller-supplied fields', () => {
    const e = buildShareEmail({ ...base, kind: 'outline', dealAddress: '<script>x</script> Road', partnerName: 'A & B' });
    expect(e.html).not.toContain('<script>x</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('A &amp; B');
  });
});
