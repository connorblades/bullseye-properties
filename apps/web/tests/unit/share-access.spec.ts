import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the token store + the legacy public loader so resolveOutlineAccess can be
// exercised without a database.
vi.mock('@/server/share/tokens', () => ({ resolveShareToken: vi.fn() }));
vi.mock('@/server/deal/public', () => ({ loadDealPublic: vi.fn(), loadReportVersionPublic: vi.fn() }));

import { resolveOutlineAccess, resolveReportAccess } from '@/server/share/access';
import { resolveShareToken } from '@/server/share/tokens';
import { loadDealPublic, loadReportVersionPublic } from '@/server/deal/public';

const mockResolve = vi.mocked(resolveShareToken);
const mockLoad = vi.mocked(loadDealPublic);
const mockVersion = vi.mocked(loadReportVersionPublic);

const fakeToken = { id: 'sht-1', dealId: 'deal-1', kind: 'outline' } as never;
const fakeReportToken = { id: 'sht-2', dealId: 'deal-1', kind: 'report', reportVersionId: null } as never;
const fakeLoaded = { deal: { address: '1 Test St' }, partner: { displayName: 'P' }, reference: 'BSE-1' } as never;
const fakeVersion = { id: 'drv-1', version: 3, pdfStoragePath: 't/d/v3.pdf' } as never;

describe('resolveOutlineAccess', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockLoad.mockReset();
  });

  it('resolves a valid token to the loaded deal with the token attached', async () => {
    mockResolve.mockResolvedValue({ ok: true, token: fakeToken });
    mockLoad.mockResolvedValue(fakeLoaded);
    const res = await resolveOutlineAccess('a-secret');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.token).toBe(fakeToken);
    expect(mockLoad).toHaveBeenCalledWith('deal-1');
  });

  it('reports not_found when a valid token points at a missing deal', async () => {
    mockResolve.mockResolvedValue({ ok: true, token: fakeToken });
    mockLoad.mockResolvedValue(null);
    expect((await resolveOutlineAccess('a-secret')).status).toBe('not_found');
  });

  it('surfaces revoked tokens', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'revoked' });
    expect((await resolveOutlineAccess('x')).status).toBe('revoked');
  });

  it('surfaces expired tokens', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'expired' });
    expect((await resolveOutlineAccess('x')).status).toBe('expired');
  });

  it('falls back to the legacy raw-ULID link when the segment is not a token', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'not_found' });
    mockLoad.mockResolvedValue(fakeLoaded);
    const res = await resolveOutlineAccess('legacy-ulid');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.token).toBeNull();
    expect(mockLoad).toHaveBeenCalledWith('legacy-ulid');
  });

  it('reports not_found when neither a token nor a legacy deal matches', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'not_found' });
    mockLoad.mockResolvedValue(null);
    expect((await resolveOutlineAccess('nope')).status).toBe('not_found');
  });

  it('degrades to the legacy path when the token store throws (e.g. table missing)', async () => {
    mockResolve.mockRejectedValue(new Error('relation "share_tokens" does not exist'));
    mockLoad.mockResolvedValue(fakeLoaded);
    const res = await resolveOutlineAccess('legacy-ulid');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.token).toBeNull();
  });
});

describe('resolveReportAccess', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    mockLoad.mockReset();
    mockVersion.mockReset();
  });

  it('resolves a valid report token with a rendered version', async () => {
    mockResolve.mockResolvedValue({ ok: true, token: fakeReportToken });
    mockLoad.mockResolvedValue(fakeLoaded);
    mockVersion.mockResolvedValue(fakeVersion);
    const res = await resolveReportAccess('sec');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.version).toBe(fakeVersion);
      expect(res.token).toBe(fakeReportToken);
    }
  });

  it('reports not_ready when the token is valid but nothing is rendered', async () => {
    mockResolve.mockResolvedValue({ ok: true, token: fakeReportToken });
    mockLoad.mockResolvedValue(fakeLoaded);
    mockVersion.mockResolvedValue(null);
    expect((await resolveReportAccess('sec')).status).toBe('not_ready');
  });

  it('has no legacy fallback: an unknown segment is not_found', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await resolveReportAccess('legacy-ulid');
    expect(res.status).toBe('not_found');
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('is not_found when the token store is unavailable (no fallback for reports)', async () => {
    mockResolve.mockRejectedValue(new Error('relation "share_tokens" does not exist'));
    expect((await resolveReportAccess('sec')).status).toBe('not_found');
  });

  it('surfaces revoked and expired report tokens', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'revoked' });
    expect((await resolveReportAccess('x')).status).toBe('revoked');
    mockResolve.mockResolvedValue({ ok: false, reason: 'expired' });
    expect((await resolveReportAccess('x')).status).toBe('expired');
  });
});
