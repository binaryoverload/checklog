export default defineAppConfig({
  ui: {
    colors: {
      primary: "sky",
      neutral: "mist",
    },
    // A compact dashboard heading rather than the default marketing-size header with a bottom border
    pageHeader: {
      slots: {
        root: "relative border-none pt-0 pb-6",
        wrapper: "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3",
        title: "text-2xl sm:text-2xl font-semibold tracking-tight text-highlighted text-pretty",
        description: "text-sm text-muted text-pretty",
      },
      variants: {
        title: {
          true: {
            description: "mt-1",
          },
        },
      },
    },
    button: {
      defaultVariants: {
        variant: "soft",
      },
    },
    badge: {
      defaultVariants: {
        variant: "soft",
      },
    },
    input: {
      defaultVariants: {
        variant: "soft",
      },
    },
    select: {
      defaultVariants: {
        variant: "soft",
      },
    },
    textarea: {
      defaultVariants: {
        variant: "soft",
      },
    },
    selectMenu: {
      defaultVariants: {
        variant: "soft",
      },
    },
    inputMenu: {
      defaultVariants: {
        variant: "soft",
      },
    },
    inputNumber: {
      defaultVariants: {
        variant: "soft",
      },
    },
    inputTags: {
      defaultVariants: {
        variant: "soft",
      },
    },
    inputDate: {
      defaultVariants: {
        variant: "soft",
      },
    },
    inputTime: {
      defaultVariants: {
        variant: "soft",
      },
    },
    pinInput: {
      defaultVariants: {
        variant: "soft",
      },
    },
  },
})
