import { BookOpen, Layers, LineChart, Scale } from 'lucide-react'

export function frameworkIcon(id: string) {
  if (id === 'probabilistic') return <Scale className="w-4 h-4 text-sky-400" />
  if (id === 'quality') return <BookOpen className="w-4 h-4 text-emerald-400" />
  if (id === 'macro') return <LineChart className="w-4 h-4 text-amber-400" />
  return <Layers className="w-4 h-4 text-violet-400" />
}
