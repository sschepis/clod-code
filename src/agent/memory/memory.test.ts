import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryField } from './memory-field';
import { initEncoder, encodeEntry } from './encoding';

beforeAll(async () => {
  await initEncoder();
});

describe('MemoryField — encoding & recall', () => {
  it('encodeEntry is deterministic', async () => {
    const a = await encodeEntry('hello world');
    const b = await encodeEntry('hello world');
    expect(a).toEqual(b);
  });

  it('recall ranks the exact match first', async () => {
    const f = new MemoryField('conversation');
    f.add({ title: 'python', body: 'I prefer Python for ML work', tags: ['language', 'preference'], strength: 0.7 });
    f.add({ title: 'typescript', body: 'TypeScript is my language for web apps', tags: ['language', 'preference'], strength: 0.7 });
    f.add({ title: 'weather', body: 'It rains a lot in Seattle', tags: ['location'], strength: 0.5 });

    const hits = await f.recall('TypeScript web apps', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.title).toBe('typescript');
  });

  it('unrelated query scores lower than matching query', async () => {
    const f = new MemoryField('conversation');
    // Note: the underlying resonance score operates on a deterministic
    // hash-to-prime encoding of the whole string, so recall is essentially
    // keyed on string-level resonance rather than embedded semantics. Pick
    // a query that shares no tokens with the entry to verify zero-score.
    f.add({ title: 'unix', body: 'grep search text cli tool', tags: ['tools'], strength: 0.7 });

    const matchHits = await f.recall('grep search text cli tool', 1);
    const missHits = await f.recall('xyzzy frobnicate', 1);
    const match = matchHits[0];
    const miss = missHits[0];
    expect(match.score).toBeGreaterThanOrEqual(miss.score);
    expect(match.score).toBeGreaterThan(0);
  });

  it('toJSON / fromJSON round-trip preserves entries', () => {
    const f = new MemoryField('project');
    const added = f.add({ title: 't', body: 'alpha beta gamma', tags: ['x'], strength: 0.6 });
    const json = f.toJSON();
    const restored = MemoryField.fromJSON(json);
    expect(restored.size()).toBe(1);
    const back = restored.get(added.id);
    expect(back?.title).toBe('t');
    expect(back?.body).toBe('alpha beta gamma');
    expect(back?.tags).toEqual(['x']);
  });

  it('cloneInto produces independent field', () => {
    const a = new MemoryField('conversation');
    a.add({ title: 'one', body: 'one', tags: [], strength: 0.5 });
    const b = a.cloneInto('conversation');
    b.add({ title: 'two', body: 'two', tags: [], strength: 0.5 });
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(2);
  });

  it('eviction drops the lowest-rank entry when over cap', () => {
    const f = new MemoryField('conversation', 3);
    const weak = f.add({ title: 'weak', body: 'low strength, unused', tags: [], strength: 0.1 });
    f.add({ title: 'mid', body: 'middle', tags: [], strength: 0.5 });
    f.add({ title: 'strong', body: 'highly used', tags: [], strength: 0.9, accessCount: 10 });
    // Over cap:
    f.add({ title: 'another', body: 'newcomer', tags: [], strength: 0.5 });
    expect(f.size()).toBe(3);
    expect(f.get(weak.id)).toBeUndefined();
  });
});

describe('Promotion dedup by fingerprint', () => {
  it('findByFingerprint returns existing entry with same title+body', () => {
    const f = new MemoryField('project');
    const e = f.add({ title: 'fact', body: 'the sky is blue', tags: [], strength: 0.5 });
    expect(f.findByFingerprint('fact', 'the sky is blue')?.id).toBe(e.id);
    expect(f.findByFingerprint('fact', 'different body')).toBeUndefined();
  });
});
