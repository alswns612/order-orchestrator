import { generateUuidV7 } from './uuidv7.util';

describe('generateUuidV7', () => {
  it('returns valid uuidv7 format', () => {
    const id = generateUuidV7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique values', () => {
    const set = new Set<string>();

    for (let i = 0; i < 1000; i += 1) {
      set.add(generateUuidV7());
    }

    expect(set.size).toBe(1000);
  });
});
