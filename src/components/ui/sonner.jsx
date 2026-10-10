import { Toaster as Sonner } from 'sonner';
function Toaster(props) { return <Sonner theme="dark" className="toaster group" toastOptions={{ classNames: { toast: 'group toast', title: 'group-[.toast]:text-foreground', description: 'group-[.toast]:text-muted-foreground', actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground', cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground' } }} {...props} />; }
export { Toaster };
