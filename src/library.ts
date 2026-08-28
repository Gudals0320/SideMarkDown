import { z } from 'zod'

export const libraryDocumentIdSchema = z.string().uuid().brand('LibraryDocumentId')

export const libraryDocumentSchema = z
  .object({
    id: libraryDocumentIdSchema,
    markdown: z.string(),
    createdAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
    updatedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  })
  .strict()

const libraryDocumentsSchema = z.array(libraryDocumentSchema)
const libraryUpdatedDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export type LibraryDocumentId = z.infer<typeof libraryDocumentIdSchema>
export type LibraryDocument = z.infer<typeof libraryDocumentSchema>

export const formatLibraryUpdatedAt = (updatedAt: number): string =>
  libraryUpdatedDateFormatter.format(new Date(updatedAt))

export type LibraryCardContent = {
  readonly title: string | null
  readonly preview: string
}

type SaveLibraryDocumentInput = {
  readonly documents: readonly LibraryDocument[]
  readonly id: LibraryDocumentId
  readonly markdown: string
  readonly timestamp: number
}

export const parseLibraryDocuments = (
  value: unknown,
): readonly LibraryDocument[] => {
  const result = libraryDocumentsSchema.safeParse(value ?? [])
  if (!result.success) return []

  return [...result.data].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )
}

export const getLibraryCardContent = (
  markdown: string,
): LibraryCardContent => {
  const [firstLine = '', ...remainingLines] = markdown.split('\n')
  const headingMatch = firstLine.match(
    /^ {0,3}#(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/,
  )

  if (!headingMatch) return { title: null, preview: markdown }

  return {
    title: headingMatch[1]?.trim() ?? '',
    preview: remainingLines.join('\n'),
  }
}

export const createLibraryDocument = ({
  documents,
  id,
  markdown,
  timestamp,
}: SaveLibraryDocumentInput): readonly LibraryDocument[] => [
  {
    id,
    markdown,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  ...documents,
]

export const updateLibraryDocument = ({
  documents,
  id,
  markdown,
  timestamp,
}: SaveLibraryDocumentInput): readonly LibraryDocument[] => {
  const selectedDocument = documents.find((document) => document.id === id)
  if (!selectedDocument) return documents

  return [
    {
      ...selectedDocument,
      markdown,
      updatedAt: timestamp,
    },
    ...documents.filter((document) => document.id !== id),
  ]
}

export const deleteLibraryDocument = (
  documents: readonly LibraryDocument[],
  id: LibraryDocumentId,
): readonly LibraryDocument[] =>
  documents.filter((document) => document.id !== id)
