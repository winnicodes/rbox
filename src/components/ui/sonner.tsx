import { Toaster as Sonner, toast, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// The app ships one theme (`class="dark"` on <html>), so the toasts do too —
// resolving "system" here would light them up on a light-mode machine.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    // A click on a toast dismisses it; its own buttons ("Show file") still work.
    // `contents` keeps the wrapper out of layout. Usually one toast is up.
    <div
      className="contents"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) toast.dismiss()
      }}
    >
      <Sonner
        theme="dark"
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast",
          },
        }}
        {...props}
      />
    </div>
  )
}

export { Toaster }
