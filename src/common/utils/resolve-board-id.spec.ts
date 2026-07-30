import { resolveBoardId } from './resolve-board-id';

describe('resolveBoardId', () => {
  it('should prefer boardId over tripId', () => {
    expect(resolveBoardId({ boardId: 'a', tripId: 'b' })).toBe('a');
  });

  it('should fall back to tripId', () => {
    expect(resolveBoardId({ tripId: 'b' })).toBe('b');
  });

  it('should return undefined when neither is set', () => {
    expect(resolveBoardId({})).toBeUndefined();
  });
});
