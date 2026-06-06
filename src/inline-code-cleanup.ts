import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark'
import type { MarkType } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

const inlineCodeCleanupPluginKey = new PluginKey('MINI_MD_INLINE_CODE_CLEANUP')

export const getCompetingInlineCodeMarkNames = (
  markTypeNames: readonly string[],
): readonly string[] =>
  markTypeNames.includes('inlineCode')
    ? markTypeNames.filter((markTypeName) => markTypeName !== 'inlineCode')
    : []

export const createInlineCodeCleanupTransaction = (
  state: EditorState,
  codeMark: MarkType,
): Transaction | null => {
  const transaction = state.tr

  state.doc.descendants((node, position) => {
    if (!node.isText || !node.marks.some((mark) => mark.type === codeMark)) {
      return true
    }

    for (const mark of node.marks) {
      if (mark.type === codeMark) continue

      transaction.removeMark(position, position + node.nodeSize, mark.type)
    }

    return true
  })

  return transaction.docChanged ? transaction : null
}

export const inlineCodeCleanupPlugin = $prose((ctx) => {
  const codeMark = inlineCodeSchema.type(ctx)

  return new Plugin({
    key: inlineCodeCleanupPluginKey,
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null
      if (
        transactions.some((transaction) =>
          transaction.getMeta(inlineCodeCleanupPluginKey)
        )
      ) {
        return null
      }

      return createInlineCodeCleanupTransaction(newState, codeMark)?.setMeta(
        inlineCodeCleanupPluginKey,
        true,
      )
    },
  })
})
