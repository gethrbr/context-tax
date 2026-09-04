/**
 * Something on the screen while the servers start.
 *
 * A run takes about ten seconds and every one of them used to be silent, because the first byte of
 * output is the finished report. Ten seconds of nothing after `npx context-tax` reads as a hang,
 * and the reader's next move is ctrl-C, which is the one thing that guarantees they never see what
 * the tool does.
 *
 * 🔒 **It writes to stderr and never to stdout.** stdout carries the report, and `--json`, `| less`
 * and `> file` all have to stay exactly as clean as they were. Progress that contaminates the
 * thing being measured is worse than no progress at all.
 *
 * 🔑 And it only draws when stderr is a **TTY**. In CI, in a pipe, or under any harness that
 * captures output, spinner frames would be recorded as content: a log full of `\\r⠹ starting…` is
 * the shape of this feature done badly, and it is the reason the check is on the stream rather
 * than on a flag somebody has to remember to pass.
 */

/** Frames, not a fixed dot: the point is to prove the process is alive, which a static line cannot. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;
const FALLBACK_WIDTH = 80;

export interface Progress {
  /** Replace the label. Safe to call before, during or after the spinner is running. */
  set(text: string): void;
  /** Erase the line and stop. Idempotent, because the error path and the happy path both call it. */
  done(): void;
}

/** A progress display that draws nothing, for every case where drawing would be wrong. */
const SILENT: Progress = { set: () => {}, done: () => {} };

interface Stream {
  isTTY?: boolean;
  columns?: number;
  write(text: string): unknown;
}

export function progress(stream: Stream = process.stderr, enabled = stream.isTTY === true): Progress {
  if (!enabled) return SILENT;

  let label = '';
  let frame = 0;
  let painted = 0;
  let stopped = false;

  const paint = (): void => {
    // Truncated to the window on purpose. A line that wraps cannot be erased by a single carriage
    // return, so an over-long server name would leave a trail of dead spinners up the screen.
    //
    // 🚨 `> 0` and not `??`. A TTY can report a width of **zero** — `script` does, and so do some
    // CI terminal emulations — and zero is not null, so a nullish fallback sails past it and
    // truncates every frame to the empty string. The spinner then silently does nothing on exactly
    // the setups where you would never think to check. Caught by running it under a pty.
    const columns = stream.columns;
    const width = columns !== undefined && columns > 0 ? columns : FALLBACK_WIDTH;
    const text = `${FRAMES[frame % FRAMES.length]} ${label}`.slice(0, Math.max(0, width - 1));
    // Pad to whatever the previous frame occupied, so a shorter label cannot leave its tail behind.
    stream.write(`\r${text}${' '.repeat(Math.max(0, painted - text.length))}`);
    painted = text.length;
  };

  const timer = setInterval(() => {
    frame += 1;
    paint();
  }, INTERVAL_MS);
  // 🔑 Never hold the event loop open. Without this a finished run would sit there spinning
  // forever, which turns a cosmetic feature into a hang.
  timer.unref();

  return {
    set: (text: string): void => {
      if (stopped) return;
      label = text;
      paint();
    },
    done: (): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      stream.write(`\r${' '.repeat(painted)}\r`);
      painted = 0;
    },
  };
}

/**
 * The label for a set of servers being started at once.
 *
 * Names them rather than counting them, because "starting linear" tells the reader what the ten
 * seconds is for and doubles as evidence of the claim the whole tool rests on: it really does start
 * your servers and perform the handshake, rather than reading a number off a file.
 */
export function startingLabel(names: Iterable<string>): string {
  const list = [...names].sort();
  if (list.length === 0) return 'measuring';
  if (list.length <= 2) return `starting ${list.join(' and ')}`;
  return `starting ${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
}
