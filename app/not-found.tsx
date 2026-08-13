export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl mb-6">📉</div>
      <h1 className="text-4xl font-bold text-white mb-3">404 — Page Not Found</h1>
      <p className="text-slate-400 mb-8 max-w-sm">
        This sector or brief does not exist in our intelligence database.
      </p>
      <a
        href="/"
        className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        ← Back to Markets
      </a>
    </div>
  )
}
