export const normalizeMarkdownForCopy = (markdown: string): string =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '')
    .replace(/[ \t]*<br\s*\/?>[ \t]*/gi, ' ')
    .replace(/\\_/g, '_')
    .replace(/^[ \t]+$/gm, '')

export type SerializedMarkdownBlock = {
  readonly type: string
  readonly markdown: string
}

const compactBlockTypes = new Set(['heading', 'paragraph'])

export const compactMarkdownBlocksForCopy = (
  serializedBlocks: readonly SerializedMarkdownBlock[],
): string => {
  const normalizedBlocks = serializedBlocks
    .map((block) => {
      const normalized = block.markdown.replace(/\r\n?/g, '\n')
      return {
        type: block.type,
        markdown: normalized.endsWith('\n')
          ? normalized.slice(0, -1)
          : normalized,
      }
    })

  return normalizedBlocks.reduce((compact, block, index) => {
    if (index === 0) return block.markdown

    const previous = normalizedBlocks[index - 1]
    const separator =
      previous &&
      compactBlockTypes.has(previous.type) &&
      compactBlockTypes.has(block.type)
        ? '\n'
        : '\n\n'
    return `${compact}${separator}${block.markdown}`
  }, '')
}
