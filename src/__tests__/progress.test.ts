/**
 * The spinner, which is the one thing in this package that writes while something else is running.
 *
 * 🔒 Every test here is about it staying out of the way. A progress display that leaks a frame into
 * stdout corrupts the report; one that leaks into a pipe corrupts a log; one that fails to erase
 * itself leaves a dead spinner sitting above the table forever. Those are the failures, and none of
 * them is caught by looking at it in a terminal, because in a terminal it looks fine.
 */

import { describe, expect, it } from 'vitest';

import { progress, startingLabel } from '../render/progress.js';

/** A stream that records instead of drawing, so the assertions are on bytes and not on a screen. */
function fake(options: { isTTY?: boolean; columns?: number } = {}) {
  const written: string[] = [];
  return {
    isTTY: options.isTTY ?? true,
    columns: options.columns,
    write(text: string): boolean {
      written.push(text);
      return true;
    },
    written,
    get all(): string {
      return written.join('');
    },
  };
}

describe('the spinner writes nothing it should not', () => {
  it('🔒 draws nothing at all when the stream is not a terminal', () => {
    // The whole guard. In CI, in a pipe, or under any harness that captures output, a frame is not
    // progress — it is content, recorded forever in somebody's build log.
    const stream = fake({ isTTY: false });
    const spinner = progress(stream);
    spinner.set('starting linear');
    spinner.done();

    expect(stream.all).toBe('');
  });

  it('erases the line when it is done, leaving the cursor at column zero', () => {
    const stream = fake({ columns: 80 });
    const spinner = progress(stream);
    spinner.set('starting linear');
    spinner.done();

    // Whatever it drew, the last thing it did was blank the line and return.
    expect(stream.all).toMatch(/\r {2,}\r$/);
    // And nothing is left behind that a reader would see over the report.
    expect(stream.all.split('\r').pop()).toBe('');
  });

  it('🚨 falls back to a default width when the terminal reports zero columns', () => {
    // `script` reports `columns: 0`, and so do some CI terminal emulations. Zero is not null, so a
    // `??` fallback sails straight past it, every frame truncates to the empty string, and the
    // spinner silently does nothing on exactly the setups nobody checks. Found by running it under
    // a pty rather than by reading the code.
    const stream = fake({ columns: 0 });
    progress(stream).set('starting linear');

    expect(stream.all).toContain('starting linear');
  });

  it('truncates to the window rather than wrapping, because a wrapped line cannot be erased', () => {
    const stream = fake({ columns: 20 });
    progress(stream).set('starting a-server-with-an-extremely-long-name');

    for (const write of stream.written) {
      expect(write.replace('\r', '').length).toBeLessThanOrEqual(20);
    }
  });

  it('covers a longer label with a shorter one instead of leaving its tail on screen', () => {
    const stream = fake({ columns: 80 });
    const spinner = progress(stream);
    spinner.set('starting one, two and three');
    spinner.set('done');

    // The shorter frame is padded out to the width the longer one occupied.
    const last = stream.written[stream.written.length - 1];
    expect(last).toMatch(/ {5,}$/);
  });

  it('stays quiet after it has been stopped, so a late callback cannot repaint over the report', () => {
    // The measure pass settles servers asynchronously. If one of those callbacks lands after the
    // report has started printing, a repaint would draw a spinner frame into the middle of it.
    const stream = fake({ columns: 80 });
    const spinner = progress(stream);
    spinner.done();
    const afterDone = stream.all.length;
    spinner.set('starting linear');
    spinner.done();

    expect(stream.all.length).toBe(afterDone);
  });
});

describe('what the label says', () => {
  it('names the servers, because the name is what explains the wait', () => {
    expect(startingLabel(['linear'])).toBe('starting linear');
    expect(startingLabel(['linear', 'figma'])).toBe('starting figma and linear');
  });

  it('counts the rest once naming them would not fit a narrow window', () => {
    expect(startingLabel(['linear', 'figma', 'sentry', 'github'])).toBe(
      'starting figma, github and 2 more',
    );
  });

  it('has something to say when every server is already cached and none is starting', () => {
    expect(startingLabel([])).toBe('measuring');
  });
});
