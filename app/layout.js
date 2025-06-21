import './globals.css'

export const metadata = {
  title: 'Landing Page Analyzer',
  description: 'Automatically capture and analyze sections of any landing page.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
