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

  it('keeps a buy button\'s text even though it lives inside a <form>', () => {
    // Real Shopify markup (matches vintagefootballshirts.com): the "Add to
    // Bag" button is a <button> inside <form action="/cart/add">. The old
    // behaviour removed the whole <form>, deleting this text from every
    // product page's markdown and leaving detectStockStatus with nothing
    // to match its "add to (cart|basket|bag)" in-stock phrase against -
    // confirmed via a production diagnostic that found this text in 0 of
    // 482 real scraped listings.
    const html = `
      <html><body>
        <main>
          <h1>1985-87 Liverpool adidas Home Shirt</h1>
          <p>&pound;103.00</p>
          <form action="/cart/add" method="post">
            <select name="id"><option value="1">M</option><option value="2">L</option></select>
            <label for="qty">Quantity</label>
            <input type="number" id="qty" value="1" />
            <button type="submit">Add to Bag</button>
          </form>
        </main>
      </body></html>
    `;
    const content = getContentHtml(html, true);
    expect(content).toContain('Add to Bag');
    expect(content).not.toContain('Quantity');
  });
});
