import * as React from 'react';
import {cn} from '../../lib/utils';
export function Badge({className,tone='green',...props}:React.ComponentProps<'span'> & {tone?:string}){return <span data-slot="badge" className={cn('badge',tone,className)} {...props}/>;}
