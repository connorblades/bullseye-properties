import { describe, expect, it } from 'vitest';
import { buildShareUrl } from '@/lib/share-url';

describe('buildShareUrl', () => {
  it('routes outline links to /o', () => {
    expect(buildShareUrl('outline', 'SEC', 'https://os.bullseyeproperties.co.uk')).toBe(
      'https://os.bullseyeproperties.co.uk/o/SEC',
    );
  });

  it('routes report links to /r', () => {
    expect(buildShareUrl('report', 'SEC', 'https://os.bullseyeproperties.co.uk')).toBe(
      'https://os.bullseyeproperties.co.uk/r/SEC',
    );
  });

  it('strips a trailing slash from the base url', () => {
    expect(buildShareUrl('outline', 'SEC', 'http://localhost:3000/')).toBe('http://localhost:3000/o/SEC');
  });
});
