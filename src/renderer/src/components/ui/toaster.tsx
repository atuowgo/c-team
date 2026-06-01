import { useToastStore } from '@/stores/toast-store'
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react'

const iconMap = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info
}

const colorMap = {
  error: 'border-red-500/50 bg-red-950/80 text-red-200',
  success: 'border-green-500/50 bg-green-950/80 text-green-200',
  info: 'border-blue-500/50 bg-blue-950/80 text-blue-200'
}

export function Toaster(): React.ReactElement {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = iconMap[t.type]
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2 px-3 py-2 rounded-md border text-sm shadow-lg ${colorMap[t.type]}`}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1 break-words">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 hover:opacity-70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}