export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

/** One log entry, whatever format it came from. */
export interface Entry {
  /** Milliseconds since 1970, or undefined when the line has no time. */
  time?: number;
  level?: Level;
  msg: string;
  /** Structured fields (JSON or logfmt), without the time, level and message keys. */
  fields: Record<string, unknown>;
  /** The original text, including continuation lines such as stack traces. */
  raw: string;
  /** Short name of the file it came from. */
  source: string;
  /** 1-based line number of the first line in its file. */
  line: number;
  format: 'json' | 'logfmt' | 'text';
}
