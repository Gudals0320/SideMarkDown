export const normalizeMarkdownForCopy = (markdown: string): string =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '')
    .replace(/[ \t]*<br\s*\/?>[ \t]*/gi, ' ')
    .replace(/\\\n/g, ' ')
    .replace(/[ \t]{2,}\n/g, ' ')
    .replace(/\\_/g, '_')
    .replace(/^[ \t]+$/gm, '')
