import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InspectionWalkthrough } from '@/components/inspection-walkthrough';

describe('guided walkthrough rendering', () => {
  it('renders one check with an explicit observation and navigation', () => {
    const html = renderToStaticMarkup(<InspectionWalkthrough onChange={() => {}} />);
    expect(html.match(/<legend/g)).toHaveLength(1);
    expect(html).toContain('Your observation');
    expect(html).toContain('Next check');
    expect(html).toContain('Moving to the next check does not mark this one as reviewed.');
  });
  it('explains an incomplete skipped check and retains its photos', () => {
    const html = renderToStaticMarkup(<InspectionWalkthrough state={{ rooms: [], activeStepKey: 'ridge-tiles', steps: { 'ridge-tiles': { result: 'not-inspected', photos: ['data:image/jpeg;base64,AA=='] } } }} onChange={() => {}} />);
    expect(html).toContain('Add a reason before this check counts as reviewed.');
    expect(html).toContain('data:image/jpeg;base64,AA==');
    expect(html).toContain('aria-invalid="true"');
  });
});
