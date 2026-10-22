import { MailMessage } from 'src/global/mail/mailer.service';
import {
  ACCOUNT_LOCALES,
  ACCOUNT_MAIL_MESSAGES,
  ACCOUNT_MAIL_STYLE,
  AccountLocale,
  AccountMailTemplate,
  DEFAULT_ACCOUNT_LOCALE,
} from './accountMail.messages';

export interface AccountMailInput {
  to: string;
  template: AccountMailTemplate;
  locale: string;
  application: string;
  link?: string;
  validityMinutes: number;
}

export function accountLocale(raw: string | undefined): AccountLocale {
  return (
    ACCOUNT_LOCALES.find((locale) => locale === raw) ?? DEFAULT_ACCOUNT_LOCALE
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );

export function composeAccountMail(input: AccountMailInput): MailMessage {
  const locale = accountLocale(input.locale);
  const catalog = ACCOUNT_MAIL_MESSAGES[locale];
  const copy = catalog.templates[input.template];
  const style = ACCOUNT_MAIL_STYLE;

  const plain = { app: input.application, minutes: input.validityMinutes };
  const safe = {
    app: escapeHtml(input.application),
    minutes: input.validityMinutes,
  };

  const subject = fill(copy.subject, plain);
  const withLink = Boolean(input.link && copy.action);
  const link = input.link ?? '';
  const safeLink = escapeHtml(link);

  const row = (content: string, css: string): string =>
    `<tr><td style="${css}">${content}</td></tr>`;

  const rows = [
    row(safe.app, `font-size:13px;color:${style.muted};padding-bottom:8px;`),
    row(
      fill(escapeHtml(copy.heading), safe),
      'font-size:20px;font-weight:bold;padding-bottom:16px;',
    ),
    row(
      fill(escapeHtml(copy.body), safe),
      'font-size:15px;line-height:1.5;padding-bottom:24px;',
    ),
  ];

  if (withLink) {
    rows.push(
      row(
        `<a href="${safeLink}" style="display:inline-block;background:${style.action};color:${style.onAction};text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px;">${escapeHtml(copy.action ?? '')}</a>`,
        'padding-bottom:16px;',
      ),
      row(
        fill(escapeHtml(catalog.validity), safe),
        `font-size:13px;color:${style.muted};padding-bottom:8px;`,
      ),
      row(
        `${escapeHtml(catalog.fallback)}<br><a href="${safeLink}" style="color:${style.action};word-break:break-all;">${safeLink}</a>`,
        `font-size:13px;color:${style.muted};padding-bottom:24px;`,
      ),
    );
  }

  rows.push(
    row(
      fill(escapeHtml(copy.closing), safe),
      `font-size:13px;color:${style.muted};padding-bottom:24px;`,
    ),
    row(
      fill(escapeHtml(catalog.footer), safe),
      `font-size:12px;color:${style.faint};border-top:1px solid ${style.rule};padding-top:16px;`,
    ),
  );

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${style.page};font-family:${style.font};color:${style.text};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${style.page};padding:24px 12px;">`,
    '<tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${style.card};border-radius:8px;padding:32px;">`,
    ...rows,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');

  const text = [
    fill(copy.heading, plain),
    '',
    fill(copy.body, plain),
    ...(withLink
      ? ['', `${copy.action}: ${link}`, fill(catalog.validity, plain)]
      : []),
    '',
    fill(copy.closing, plain),
    '',
    fill(catalog.footer, plain),
  ].join('\n');

  return { to: input.to, subject, html, text };
}
