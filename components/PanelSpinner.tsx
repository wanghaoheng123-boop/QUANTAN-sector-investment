/**
 * PanelSpinner — the fallback shown while a lazily-loaded tab panel arrives.
 *
 * Q-117. The tab panels on /stock/[ticker] and /sector/[slug] are code-split,
 * so switching tabs now has a network step where it previously had none. Without
 * a fallback `next/dynamic` renders nothing, and an empty panel is
 * indistinguishable from a panel that failed — the same "missing reads as
 * something else" confusion the data-state work removed elsewhere.
 *
 * Mirrors the spinner the options tab already used for its own fetch, so a tab
 * that is loading CODE and a tab that is loading DATA look the same to the user,
 * which is correct: the distinction is ours, not theirs.
 */
export function PanelSpinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-12 text-gray-400 text-sm"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block w-4 h-4 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin"
        aria-hidden="true"
      />
      Loading {label}…
    </div>
  )
}

export default PanelSpinner
