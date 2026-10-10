import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';
const Switch = SwitchPrimitive.Root;
const SwitchThumb = ({ className, ...props }) => <SwitchPrimitive.Thumb className={cn('pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0', className)} {...props} />;
export { Switch, SwitchThumb };
