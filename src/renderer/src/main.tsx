import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import App from "./App"
import "./assets/index.css"

const root = createRoot(document.getElementById("root")!)
root.render(
  <ThemeProvider defaultTheme="dark">
    <App />
  </ThemeProvider>
)