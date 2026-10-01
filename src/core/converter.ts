import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Remove script and style tags
turndownService.addRule('remove-noisy-elements', {
  filter: ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas'],
  replacement: () => '',
});

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}
