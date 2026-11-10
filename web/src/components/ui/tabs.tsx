import * as Primitive from '@radix-ui/react-tabs';
import type {ComponentProps} from 'react';
import {cn} from '../../lib/utils';
export const Tabs=Primitive.Root;
export function TabsList({className,...props}:ComponentProps<typeof Primitive.List>){return <Primitive.List className={cn('tabs-list',className)} {...props}/>;}
export function TabsTrigger({className,...props}:ComponentProps<typeof Primitive.Trigger>){return <Primitive.Trigger className={cn('tabs-trigger',className)} {...props}/>;}
export function TabsContent({className,...props}:ComponentProps<typeof Primitive.Content>){return <Primitive.Content className={cn('tabs-content',className)} {...props}/>;}
