import type { Metadata } from "next"
import { Space_Grotesk } from "next/font/google"
import { Suspense } from "react"

import "./obs.css"

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })

export const metadata: Metadata = {
  title: "Chorus — Mission Control",
  description: "Live observability for the Chorus stack",
}

export default function ObservabilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`obs ${spaceGrotesk.variable}`}>
      <Suspense>{children}</Suspense>
    </div>
  )
}
