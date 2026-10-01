import { InFlightWork } from './in-flight-work';

describe('InFlightWork', () => {
  it('shares overlapping calls, but runs again after completion', async () => {
    const work = new InFlightWork<number>();
    let complete!: (value: number) => void;
    const task = jest.fn(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const first = work.run('board:user', 12, task);
    const second = work.run('board:user', 12, task);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    complete(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    await expect(
      work.run('board:user', 12, () => Promise.resolve(2)),
    ).resolves.toBe(2);
  });

  it('waits for the smaller horizon then performs the requested larger horizon once', async () => {
    const work = new InFlightWork<number>();
    let complete!: (value: number) => void;
    const small = work.run(
      'board:user',
      12,
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const largerTask = jest.fn(() => Promise.resolve(60));
    const larger = work.run('board:user', 60, largerTask);
    const another = work.run('board:user', 60, largerTask);
    await Promise.resolve();
    expect(largerTask).not.toHaveBeenCalled();
    complete(12);
    expect(await Promise.all([small, larger, another])).toEqual([12, 60, 60]);
    expect(largerTask).toHaveBeenCalledTimes(1);
  });

  it('isolates identities and releases failed work for a retry', async () => {
    const work = new InFlightWork<number>();
    await expect(
      work.run('board:a', 12, () => Promise.reject(new Error('db'))),
    ).rejects.toThrow('db');
    expect(
      await Promise.all([
        work.run('board:a', 12, () => Promise.resolve(1)),
        work.run('board:b', 12, () => Promise.resolve(2)),
      ]),
    ).toEqual([1, 2]);
  });
});
