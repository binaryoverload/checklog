declare module "#app" {
  interface PageMeta {
    /**
     * Who can open the page: anyone, signed-in users, or platform admins only
     * @default "private"
     */
    auth?: "public" | "private" | "platform-admin"
    /** Shown in the navbar of the default layout */
    title?: string
  }
}

export {}
