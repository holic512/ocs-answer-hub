import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import type {ReactNode} from 'react';
import {Button} from './button';
export function Sheet({title,description,children,onClose,wide=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className={`sheet ${wide?'sheet-wide':''}`} aria-describedby={description?'sheet-description':undefined}><header><div><Dialog.Title asChild><h2>{title}</h2></Dialog.Title>{description&&<Dialog.Description id="sheet-description">{description}</Dialog.Description>}</div><Dialog.Close asChild><Button size="icon" aria-label="关闭侧栏"><X size={18}/></Button></Dialog.Close></header><div className="sheet-body">{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
