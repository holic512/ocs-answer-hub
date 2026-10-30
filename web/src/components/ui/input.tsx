import * as React from 'react';
import {cn} from '../../lib/utils';
export function Input({className,...props}:React.ComponentProps<'input'>){return <input data-slot="input" className={cn('ui-input',className)} {...props}/>;}
export function Textarea({className,...props}:React.ComponentProps<'textarea'>){return <textarea data-slot="textarea" className={cn('ui-input',className)} {...props}/>;}
export function NativeSelect({className,...props}:React.ComponentProps<'select'>){return <select data-slot="native-select" className={cn('ui-input',className)} {...props}/>;}
