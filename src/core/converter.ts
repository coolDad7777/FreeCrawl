import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function createService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    preformattedCode: true,
  });

  service.use(gfm);

  service.remove(['script', 'style', 'noscript', 'template', 'iframe', 'canvas']);
  service.addRule('dropSvg', { filter: ['svg' as never], replacement: () => '' });

  // Highlighted code blocks usually carry the language in a `language-*` class.
  service.addRule('fencedCodeWithLanguage', {
    filter: (node) =>
      node.nodeName === 'PRE' &&
      node.firstChild !== null &&
      node.firstChild.nodeName === 'CODE',
    replacement: (_content, node) => {
      const code = (node as HTMLElement).firstChild as HTMLElement;
      const className = code.getAttribute?.('class') ?? '';
      const language = className.match(/(?:language|lang|highlight)-([\w+#-]+)/)?.[1] ?? '';
      const text = (code.textContent ?? '').replace(/\n+$/, '');
      return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    },
  });

  // Keep the alt text of informative images, drop spacers and tracking pixels.
  service.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const src = element.getAttribute('src') ?? '';
      if (!src || src.startsWith('data:')) return '';
      const alt = (element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
      const title = element.getAttribute('title');
      return `![${alt}](${src}${title ? ` "${title}"` : ''})`;
    },
  });

  // Anchors with no destination add noise to LLM input.
  service.addRule('emptyLinks', {
    filter: (node) => node.nodeName === 'A' && !(node as HTMLElement).getAttribute?.('href'),
    replacement: (content) => content,
  });

  return service;
}

const turndownService = createService();

/** Collapses the runs of blank lines and stray escapes Turndown leaves behind. */
export function tidyMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(\s*[-*]\s*)+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  try {
    return tidyMarkdown(turndownService.turndown(html));
  } catch {
    // Malformed markup should degrade to plain text rather than fail the scrape.
    return tidyMarkdown(html.replace(/<[^>]+>/g, ' '));
  }
}
