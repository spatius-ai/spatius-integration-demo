import '@spatius/avatarkit'

declare module '@spatius/avatarkit' {
  interface Configuration {
    readonly region?: string
  }
}
