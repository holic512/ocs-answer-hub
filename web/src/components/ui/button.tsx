import * as React from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';
export const buttonVariants = cva('ui-button', {variants: {variant: {default:'primary', outline:'secondary', ghost:'ghost', destructive:'destructive'}, size: {default:'', sm:'ui-button-sm', icon:'ui-button-icon'}}, defaultVariants:{variant:'ghost',size:'default'}});
export function Button({className,variant,size,asChild=false,...props}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {asChild?:boolean}) {
 const Comp=asChild?Slot:'button';
 return <Comp data-slot="button" className={cn(buttonVariants({variant,size}),className)} {...props}/>;
}
