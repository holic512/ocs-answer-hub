import * as Primitive from '@radix-ui/react-checkbox';
import {Check} from 'lucide-react';
import type {ComponentProps} from 'react';
export function Checkbox(props:ComponentProps<typeof Primitive.Root>){return <Primitive.Root className="ui-checkbox" {...props}><Primitive.Indicator><Check size={13}/></Primitive.Indicator></Primitive.Root>;}
