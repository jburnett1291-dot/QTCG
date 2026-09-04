import { ToastProvider, ToastViewport } from "@/components/ui/toast"

export function Toaster() {
  return (
    <ToastProvider>
      <ToastViewport />
    </ToastProvider>
  )
}
