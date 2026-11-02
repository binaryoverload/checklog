declare module "#app" {
  interface PageMeta {
    /**
     * Who can open the page
     * @default "private"
     */
    auth?: "public" | "private"
    /** Shown in the navbar of the default layout */
    title?: string
  }
}

export {}
