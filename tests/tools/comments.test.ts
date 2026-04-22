import { describe, test, expect } from 'bun:test';
import { injectMarker } from '../../src/tools/comments.ts';
import type { RichTextSegment } from '../../src/types.ts';

const DID = 'd1scus51-0000-0000-0000-000000000000';

describe('injectMarker', () => {
  test('anchors in a single plain segment', () => {
    const input: RichTextSegment[] = [['Hello world, greetings.']];
    const { segments, context } = injectMarker(input, 'world', DID);

    expect(segments).toEqual([
      ['Hello '],
      ['world', [['m', DID]]],
      [', greetings.'],
    ]);
    expect(context).toEqual([['world', [['m', DID]]]]);
  });

  test('preserves existing decorations on the matched span', () => {
    const input: RichTextSegment[] = [['important note', [['b']]]];
    const { segments, context } = injectMarker(input, 'note', DID);

    expect(segments).toEqual([
      ['important ', [['b']]],
      ['note', [['b'], ['m', DID]]],
    ]);
    expect(context).toEqual([['note', [['b'], ['m', DID]]]]);
  });

  test('anchor spans across multiple segments', () => {
    const input: RichTextSegment[] = [
      ['Hello '],
      ['beautiful', [['b']]],
      [' world.'],
    ];
    const { segments, context } = injectMarker(input, 'beautiful world', DID);

    expect(segments).toEqual([
      ['Hello '],
      ['beautiful', [['b'], ['m', DID]]],
      [' world', [['m', DID]]],
      ['.'],
    ]);
    expect(context).toEqual([
      ['beautiful', [['b'], ['m', DID]]],
      [' world', [['m', DID]]],
    ]);
  });

  test('anchor at start', () => {
    const input: RichTextSegment[] = [['start middle end']];
    const { segments } = injectMarker(input, 'start', DID);
    expect(segments).toEqual([
      ['start', [['m', DID]]],
      [' middle end'],
    ]);
  });

  test('anchor at end', () => {
    const input: RichTextSegment[] = [['start middle end']];
    const { segments } = injectMarker(input, 'end', DID);
    expect(segments).toEqual([
      ['start middle '],
      ['end', [['m', DID]]],
    ]);
  });

  test('anchor equals entire segment', () => {
    const input: RichTextSegment[] = [['hello']];
    const { segments } = injectMarker(input, 'hello', DID);
    expect(segments).toEqual([['hello', [['m', DID]]]]);
  });

  test('throws when anchor not found', () => {
    const input: RichTextSegment[] = [['hello world']];
    expect(() => injectMarker(input, 'missing', DID)).toThrow(/not found/);
  });

  test('throws on empty anchor', () => {
    const input: RichTextSegment[] = [['hello']];
    expect(() => injectMarker(input, '', DID)).toThrow(/must not be empty/);
  });
});
