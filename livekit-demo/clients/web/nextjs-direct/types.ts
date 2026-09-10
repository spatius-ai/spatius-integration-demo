/**
 * The shapes the two views pass between each other.
 *
 * In their own file rather than beside the page component: the page defers the
 * whole app through `next/dynamic` to keep the SDK out of the server pass, and a
 * component importing its types back from that module would close a cycle through
 * the very import being deferred.
 */

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}
