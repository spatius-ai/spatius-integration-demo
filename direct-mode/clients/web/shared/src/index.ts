/**
 * Shared Direct Mode client core.
 *
 * Framework-agnostic on purpose: the five clients in this directory differ only in
 * how they draw a button, so what talks to the backend lives here and each framework
 * writes only its own UI.
 */
export * from './backend'
