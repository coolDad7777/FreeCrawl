import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Remove script and style tags
turndownService.addRule('remove-scripts', {
  filter: ['script', 'style', 'noscript', 'iframe'],
  replacement: () => '',
});

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}
