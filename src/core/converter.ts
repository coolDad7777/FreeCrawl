import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element as DomElement } from 'domhandler';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Cell contents that a GFM pipe table can never hold. Tables containing these
 * are reshaped into ordinary blocks instead, which reads far better than a row
 * that has been torn across several lines.
 */
const BLOCK_LEVEL_CELL_CONTENT =
  'pre, table, ul, ol, dl, blockquote, h1, h2, h3, h4, h5, h6, figure, hr';

function tableRows($: CheerioAPI, table: DomElement): DomElement[] {
  const rows: DomElement[] = [];
  for (const child of $(table).children().toArray()) {
    const tag = child.tagName?.toLowerCase();
    if (tag === 'tr') rows.push(child);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      rows.push(...$(child).children('tr').toArray());
    }
  }
  return rows;
}

function rowCells($: CheerioAPI, row: DomElement): DomElement[] {
  return $(row).children('th, td').toArray();
}

/** True when no amount of reshaping would yield a usable pipe table. */
function isLayoutTable($: CheerioAPI, table: DomElement, rows: DomElement[]): boolean {
  const role = ($(table).attr('role') ?? '').toLowerCase();
  if (role === 'presentation' || role === 'none') return true;
  if (rows.length === 0) return true;

  const grid = rows.map((row) => rowCells($, row));
  if (grid.length === 1 && grid[0].length <= 1) return true;
  return grid.some((cells) => cells.some((cell) => $(cell).find(BLOCK_LEVEL_CELL_CONTENT).length > 0));
}

/** Replaces a table with its cells laid out as consecutive blocks. */
function flattenTable($: CheerioAPI, table: DomElement, rows: DomElement[]): void {
  const blocks: string[] = [];
  for (const row of rows) {
    for (const cell of rowCells($, row)) {
      const inner = $(cell).html();
      if (inner && inner.trim()) blocks.push(`<div>${inner}</div>`);
    }
  }
  $(table).replaceWith(blocks.length > 0 ? `<div>${blocks.join('')}</div>` : '');
}

/**
 * Reshapes table markup so every table Turndown sees is one GFM can express.
 * Without this, `turndown-plugin-gfm` emits header-less tables as raw HTML and
 * lets block-level cell content break rows apart.
 */
export function normalizeTables(html: string): string {
  if (!/<table[\s>]/i.test(html)) return html;

  const $ = cheerio.load(html, null, false);

  // Innermost first: flattening an outer table would otherwise re-insert nested
  // markup that no longer gets visited.
  for (const table of $('table').toArray().reverse()) {
    // A caption cannot live inside a pipe table, so lift it out as a heading.
    const caption = $(table).children('caption');
    const captionHtml = caption.html();
    if (captionHtml && captionHtml.trim()) $(table).before(`<p><strong>${captionHtml}</strong></p>`);
    caption.remove();

    let rows = tableRows($, table);
    for (const row of rows) {
      if (rowCells($, row).length === 0) $(row).remove();
    }
    rows = rows.filter((row) => rowCells($, row).length > 0);

    if (isLayoutTable($, table, rows)) {
      flattenTable($, table, rows);
      continue;
    }

    // GFM requires a leading header row; promoting the first row preserves the
    // data rather than falling back to raw HTML.
    for (const cell of rowCells($, rows[0])) cell.tagName = 'th';
  }

  return $.html();
}

const CELL_NODE_NAMES = new Set(['TH', 'TD']);
const SECTION_NODE_NAMES = new Set(['THEAD', 'TBODY', 'TFOOT']);
const ALIGNMENTS: Record<string, string> = { left: ':---', right: '---:', center: ':---:' };

function childElements(node: Node | null): Element[] {
  const elements: Element[] = [];
  for (let child = node?.firstChild ?? null; child; child = child.nextSibling) {
    if (child.nodeType === 1) elements.push(child as Element);
  }
  return elements;
}

function cellsOf(row: Node | null): Element[] {
  return childElements(row).filter((child) => CELL_NODE_NAMES.has(child.nodeName));
}

function domTableRows(table: Node): Element[] {
  const rows: Element[] = [];
  for (const child of childElements(table)) {
    if (child.nodeName === 'TR') rows.push(child);
    else if (SECTION_NODE_NAMES.has(child.nodeName)) {
      rows.push(...childElements(child).filter((node) => node.nodeName === 'TR'));
    }
  }
  return rows;
}

/** GFM only recognizes a leading header row, so only the first row qualifies. */
function isHeaderRow(row: Node): boolean {
  for (let current = row.parentNode; current; current = current.parentNode) {
    if (current.nodeName === 'TABLE') return domTableRows(current)[0] === row;
  }
  return false;
}

function columnSpan(cell: Element): number {
  const span = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
  return Number.isFinite(span) && span > 1 ? Math.min(span, 32) : 1;
}

function alignmentOf(cell: Element): string {
  const attribute = (cell.getAttribute('align') ?? '').toLowerCase();
  const style = (cell.getAttribute('style') ?? '').toLowerCase();
  const fromStyle = style.match(/text-align\s*:\s*(left|right|center)/)?.[1] ?? '';
  return ALIGNMENTS[attribute] ?? ALIGNMENTS[fromStyle] ?? '---';
}

function addTableRules(service: TurndownService): void {
  service.addRule('table', {
    filter: 'table',
    replacement: (content) => {
      const body = content.replace(/\n{2,}/g, '\n').trim();
      return body ? `\n\n${body}\n\n` : '';
    },
  });

  service.addRule('tableSection', {
    filter: ['thead' as never, 'tbody' as never, 'tfoot' as never],
    replacement: (content) => content,
  });

  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const row = content.replace(/\s*\n+\s*/g, ' ').trimEnd();
      if (!row.trim()) return '';
      if (!isHeaderRow(node)) return `\n${row}`;

      const divider = cellsOf(node)
        .flatMap((cell) => Array.from({ length: columnSpan(cell) }, () => alignmentOf(cell)))
        .map((alignment) => ` ${alignment} |`)
        .join('');
      return `\n${row}\n|${divider}`;
    },
  });

  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const text = content
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const prefix = cellsOf(node.parentNode)[0] === node ? '| ' : ' ';
      return `${prefix}${text} |${' |'.repeat(columnSpan(node as Element) - 1)}`;
    },
  });

  // Captions are lifted out of the table by normalizeTables(); anything left
  // would corrupt the row that follows it.
  service.addRule('tableCaption', { filter: 'caption' as never, replacement: () => '' });
}

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

  // gfm supplies strikethrough and task lists; its table rules are superseded
  // by addTableRules below, which never falls back to raw HTML.
  service.use(gfm);
  addTableRules(service);

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
    return tidyMarkdown(turndownService.turndown(normalizeTables(html)));
  } catch {
    // Malformed markup should degrade to plain text rather than fail the scrape.
    return tidyMarkdown(html.replace(/<[^>]+>/g, ' '));
  }
}
