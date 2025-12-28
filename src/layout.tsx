import type { LayoutProps } from './types'

export const Layout = ({ children, title = 'Banno Plugin' }: LayoutProps) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light" />
        <title>{title}</title>
        {/* Bootstrap 5 + Bootswatch Sandstone */}
        <link
          href="https://cdn.jsdelivr.net/npm/bootswatch@5.3.3/dist/sandstone/bootstrap.min.css"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
          <div class="container-fluid">
            <span class="navbar-brand mb-0 h1">Banno Plugin</span>
          </div>
        </nav>
        <main class="py-5">
          <div class="container">
            {children}
          </div>
        </main>
        <footer class="bg-light py-4 mt-5">
          <div class="container text-center text-muted">
            <p>&copy; 2025 Banno Plugin Starter</p>
          </div>
        </footer>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
      </body>
    </html>
  )
}