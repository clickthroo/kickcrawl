import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

turndown.remove(['script', 'style', 'noscript', 'iframe']);

export function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html).trim();
  } catch {
    return '';
  }
}
