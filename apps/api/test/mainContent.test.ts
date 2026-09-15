import { describe, expect, it } from 'vitest';
import { getContentHtml } from '../src/services/mainContent.js';

describe('getContentHtml', () => {
  it('strips nav/header/footer chrome', () => {
    const html = `
      <html><body>
        <header>Site Header</header>
        <nav>Menu</nav>
        <main><h1>Product</h1><p>Details</p></main>
        <footer>Site Footer</footer>
      </body></html>
    `;
    const content = getContentHtml(html, true);
    expect(content).not.toContain('Site Header');
    expect(content).not.toContain('Site Footer');
    expect(content).toContain('Product');
  });

  it('falls back to body content when no main-content container is found', () => {
    const html = '<html><body><div>Just some text here that is long enough to matter</div></body></html>';
    const content = getContentHtml(html, true);
    expect(content).toContain('Just some text');
  });
});
