/**
 * @file dialog.tsx
 * @project ocs-answer-hub
 * @module UI / Dialog
 * @description 基于 Radix 的受控弹窗，统一标题、关闭与焦点管理。
 * @logic Portal 挂载、焦点锁定、Escape 关闭与关闭后焦点恢复。
 * @dependencies @radix-ui/react-dialog, button, lucide-react
 * @index_tags ui, dialog, accessibility
 * @author holic512
 */
import type {ReactNode} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {Button} from './button';
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="modal" aria-describedby={undefined}><header><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><Dialog.Close asChild><Button className="icon" aria-label="关闭"><X size={18}/></Button></Dialog.Close></header>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
