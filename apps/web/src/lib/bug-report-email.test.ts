import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUG_REPORT_RECIPIENT, bugReportText, sendBugReportEmail } from './bug-report-email';

const payload = {
  reporterName: 'Ana Lima',
  reporterEmail: 'ana@evecompany.com.br',
  message: 'O botão Agendar não responde.',
  attachments: [{ filename: 'print.png', url: '/uploads/bug-reports/print.png' }],
  createdAt: new Date('2026-09-22T20:15:00.000Z'),
};

describe('bug report e-mail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('goes to jose@evecompany.com.br', () => {
    expect(BUG_REPORT_RECIPIENT).toBe('jose@evecompany.com.br');
  });

  it('says who, when (São Paulo time) and what, with attachments as full links', () => {
    const text = bugReportText(payload, 'https://evecompany.cloud');
    expect(text).toContain('Ana Lima <ana@evecompany.com.br> em 22/09/2026, 17:15:');
    expect(text).toContain('O botão Agendar não responde.');
    expect(text).toContain('- print.png: https://evecompany.cloud/uploads/bug-reports/print.png');
  });

  it('sends nothing, and says so, while SMTP_URL is unset', async () => {
    // getEnv() insists on the required variables; none of them is touched here.
    vi.stubEnv('DATABASE_URL', 'postgresql://unused');
    vi.stubEnv('CREDENTIALS_KEY', 'unused');
    vi.stubEnv('SMTP_URL', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { resetEnvCache } = await import('@eve/core');
    resetEnvCache();
    expect(await sendBugReportEmail(payload)).toBe(false);
    expect(log.mock.calls.flat().join(' ')).toContain('SMTP_URL vazio');
    log.mockRestore();
    resetEnvCache();
  });
});
