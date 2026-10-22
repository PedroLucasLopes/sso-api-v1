import { LOGO_MAX_BYTES, logoProblem } from './logo';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const dataUri = (type: string, bytes: Buffer) =>
  `data:${type};base64,${bytes.toString('base64')}`;

const png = (size: number) =>
  Buffer.concat([Buffer.from(PNG_HEADER), Buffer.alloc(size)]);

describe('logo do projeto', () => {
  it('aceita PNG, JPEG e WebP pequenos', () => {
    expect(logoProblem(dataUri('image/png', png(64)))).toBeNull();
    expect(
      logoProblem(
        dataUri('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])),
      ),
    ).toBeNull();
    expect(
      logoProblem(
        dataUri(
          'image/webp',
          Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.alloc(4),
            Buffer.from('WEBPVP8 '),
          ]),
        ),
      ),
    ).toBeNull();
  });

  it('recusa SVG, URL e o que nao e data URI', () => {
    expect(
      logoProblem(dataUri('image/svg+xml', Buffer.from('<svg></svg>'))),
    ).toBe('logo_invalid');
    expect(logoProblem('https://exemplo.com/logo.png')).toBe('logo_invalid');
  });

  it('recusa bytes que nao batem com o tipo declarado', () => {
    expect(logoProblem(dataUri('image/png', Buffer.from('GIF89a....')))).toBe(
      'logo_invalid',
    );
  });

  it('recusa logo acima do limite', () => {
    expect(logoProblem(dataUri('image/png', png(LOGO_MAX_BYTES)))).toBe(
      'logo_too_large',
    );
  });
});
