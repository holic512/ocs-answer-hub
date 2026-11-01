import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {Button} from './button';
export function Confirmation({message,onAnswer}:{message:string;onAnswer:(answer:boolean)=>void}){
 return <AlertDialog.Root open onOpenChange={open=>{if(!open)onAnswer(false);}}><AlertDialog.Portal><AlertDialog.Overlay className="overlay"/><AlertDialog.Content className="modal confirmation"><AlertDialog.Title asChild><h2>确认操作</h2></AlertDialog.Title><AlertDialog.Description asChild><p>{message}</p></AlertDialog.Description><div className="modal-actions"><AlertDialog.Cancel asChild><Button variant="outline" onClick={()=>onAnswer(false)}>取消</Button></AlertDialog.Cancel><AlertDialog.Action asChild><Button variant="destructive" onClick={()=>onAnswer(true)}>确认继续</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}
