/**
 * Shared Direct Mode client core.
 *
 * Framework-agnostic on purpose: the five clients in this directory differ only in
 * how they draw a button, so everything that talks to the backend or the SDK lives
 * here and each framework writes only its own UI.
 */
export * from './backend'
export * from './avatar'
export * from './audio'
export * from './scenes'
