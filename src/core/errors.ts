// Error vocabulary and process exit codes.
//
// Every failure a user can cause is an `AppError` with a stable code. Anything
// else escaping to the entry point is a defect and exits 3.

/** Documented exit codes. These are part of the command-line contract. */
export const ExitCode = {
  /** The command completed and nothing it was asked to check failed. */
  Success: 0,
  /** The request failed, or a check the user asked for did not hold. */
  Failure: 1,
  /** Usage error: unknown command, unknown flag, invalid argument. */
  Usage: 2,
  /** Unexpected internal error. */
  Internal: 3,
  /** Interrupted (128 + SIGINT). */
  Interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorCode =
  | 'usage'
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'destination-refused'
  | 'dns-failure'
  | 'connection-failed'
  | 'tls-failure'
  | 'timeout'
  | 'too-many-redirects'
  | 'invalid-redirect'
  | 'response-too-large'
  | 'body-read-failed'
  | 'config-invalid'
  | 'history-unavailable'
  | 'cancelled';

const EXIT_BY_CODE: Record<ErrorCode, ExitCodeValue> = {
  usage: ExitCode.Usage,
  'invalid-url': ExitCode.Usage,
  'unsupported-scheme': ExitCode.Usage,
  'destination-refused': ExitCode.Failure,
  'dns-failure': ExitCode.Failure,
  'connection-failed': ExitCode.Failure,
  'tls-failure': ExitCode.Failure,
  timeout: ExitCode.Failure,
  'too-many-redirects': ExitCode.Failure,
  'invalid-redirect': ExitCode.Failure,
  'response-too-large': ExitCode.Failure,
  'body-read-failed': ExitCode.Failure,
  'config-invalid': ExitCode.Usage,
  'history-unavailable': ExitCode.Failure,
  cancelled: ExitCode.Interrupted,
};

/**
 * An error with a message written for the person who ran the command.
 *
 * Messages must never contain header values, request bodies or anything else
 * that could carry a credential: an error is printed, logged and pasted into
 * issue reports.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** One line of guidance, printed under the message. */
  readonly hint: string | undefined;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = hint;
  }

  get exitCode(): ExitCodeValue {
    return EXIT_BY_CODE[this.code];
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function usageError(message: string, hint?: string): AppError {
  return new AppError('usage', message, hint);
}
