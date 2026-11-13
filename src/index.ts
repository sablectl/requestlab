// Library surface.
//
// RequestLab is a command-line tool first. These exports exist so that its
// parts can be used from a script without spawning a process; they follow the
// same compatibility promise as the CLI.

export { VERSION } from './version.js';
export { run } from './cli/run.js';
export type { Io } from './cli/run.js';
export { send, parseRequestUrl } from './core/transport.js';
export type { SendOptions } from './core/transport.js';
export { compareExchanges, DEFAULT_VOLATILE_HEADERS } from './core/compare.js';
export type {
  Comparison,
  ComparisonOptions,
  Difference,
} from './core/compare.js';
export {
  classifyAddress,
  isGloballyRoutable,
  describeScope,
} from './core/destination.js';
export type { AddressScope, ClassifiedAddress } from './core/destination.js';
export {
  redactHeaders,
  redactText,
  redactUrl,
  isSensitiveHeader,
  isSensitiveParam,
  REDACTED,
} from './core/redact.js';
export { AppError, ExitCode, isAppError } from './core/errors.js';
export type { ErrorCode, ExitCodeValue } from './core/errors.js';
export { DEFAULT_SETTINGS, loadSettings } from './core/config.js';
export type { Settings } from './core/config.js';
export { applyRetention, readHistory } from './core/history.js';
export type { HistoryEntry, RetentionPolicy } from './core/history.js';
export type {
  Exchange,
  HeaderPair,
  Hop,
  HttpMethod,
  RequestSpec,
  TlsInfo,
} from './core/types.js';
