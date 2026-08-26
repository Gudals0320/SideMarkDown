export const normalizeMarkdownForCopy = (markdown: string): string =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '')
    .replace(/[ \t]*<br\s*\/?>[ \t]*/gi, ' ')
    .replace(/\\\n/g, ' ')
    .replace(/[ \t]{2,}\n/g, ' ')
    .replace(/\\_/g, '_')
    .replace(/^[ \t]+$/gm, '')

export const compactMarkdownBlocksForCopy = (
  serializedBlocks: readonly string[],
): string =>
  serializedBlocks
    .map((block) => {
      const normalized = block.replace(/\r\n?/g, '\n')
      return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
    })
    .join('\n')
