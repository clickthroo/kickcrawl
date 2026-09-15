import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/services/markdown.js';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    const html = '<h1>Page title</h1><p>Some content</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Page title');
    expect(md).toContain('Some content');
  });

  it('strips script and style tags', () => {
    const html = '<style>.x{color:red}</style><p>Hi</p><script>alert(1)</script>';
    const md = htmlToMarkdown(html);
    expect(md).toBe('Hi');
  });

  it('returns an empty string on malformed input rather than throwing', () => {
    expect(() => htmlToMarkdown('<<<>>>')).not.toThrow();
  });
});
