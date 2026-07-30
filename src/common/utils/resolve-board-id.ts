/**
 * Resolve boardId from DTOs/queries that accept boardId or legacy tripId.
 */
export function resolveBoardId(input: {
  boardId?: string;
  tripId?: string;
}): string | undefined {
  return input.boardId || input.tripId;
}
