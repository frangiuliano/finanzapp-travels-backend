/**
 * Compatibility re-exports. Prefer importing from `./board.schema`.
 * The MongoDB collection remains `trips` until a future infra rename.
 */
export {
  Board as Trip,
  BoardSchema as TripSchema,
  Board,
  BoardSchema,
  BoardType,
  BoardDocument,
  BoardDocument as TripDocument,
} from './board.schema';
