import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

interface ThemeProviderState {
  theme: Theme
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "cteam-theme",
  ...props
}: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme
    return (localStorage.getItem(storageKey) as Theme) || defaultTheme
  })

  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark")

  useEffect(() => {
    localStorage.setItem(storageKey, theme)
  }, [theme, storageKey])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      const apply = (e: MediaQueryListEvent | MediaQueryList): void => {
        const resolved = e.matches ? "dark" : "light"
        setResolvedTheme(resolved)
        root.classList.add(resolved)
      }
      apply(media)
      media.addEventListener("change", apply)
      return () => media.removeEventListener("change", apply)
    } else {
      setResolvedTheme(theme)
      root.classList.add(theme)
      return
    }
  }, [theme])

  const setTheme = (t: Theme): void => setThemeState(t)

  const toggleTheme = (): void => {
    setThemeState((prev) => {
      if (prev === "system") return resolvedTheme === "dark" ? "light" : "dark"
      return prev === "dark" ? "light" : "dark"
    })
  }

  return (
    <ThemeProviderContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }} {...props}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}