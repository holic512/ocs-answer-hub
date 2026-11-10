/**
 * @file select.tsx
 * @project ocs-answer-hub
 * @module UI / Select
 * @description 统一表单与筛选下拉，支持键盘导航、表单提交与重置。
 * @logic Radix Portal 展示选项，保留受控值与表单字段契约。
 * @dependencies @radix-ui/react-select, lucide-react
 * @index_tags ui, select, accessibility
 * @author holic512
 */
import {Children,isValidElement,useEffect,useRef,useState,type ReactElement,type ComponentProps} from 'react';
import * as Primitive from '@radix-ui/react-select';
import {Check,ChevronDown,ChevronUp} from 'lucide-react';
import {cn} from '../../lib/utils';
import {useFieldControl} from './form';
type Props=Omit<ComponentProps<'select'>,'onChange'|'value'|'defaultValue'|'multiple'|'size'> & {value?:string;defaultValue?:string;onChange?:(event:{target:{value:string}})=>void};
export function Select({children,value,defaultValue,onChange,name,required,disabled,className,id,'aria-label':label}:Props){
 const field=useFieldControl();
 const options=Children.toArray(children).filter(isValidElement) as ReactElement<ComponentProps<'option'>>[];
 const initial=defaultValue??String(options[0]?.props.value??'');
 const [local,setLocal]=useState(initial);const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const form=trigger.current?.closest('form');const reset=()=>setLocal(initial);form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);},[initial]);
 return <Primitive.Root name={name} required={required} disabled={disabled} value={value??local} onValueChange={next=>{const selected=next;setLocal(selected);onChange?.({target:{value:selected}});}}>
  <Primitive.Trigger ref={trigger} id={id??field.id} aria-invalid={field['aria-invalid']} aria-describedby={field['aria-describedby']} aria-label={label} className={cn('ui-input ui-select',className)}><Primitive.Value placeholder={options.find(option=>option.props.value==='')?.props.children??'请选择'}/><Primitive.Icon><ChevronDown size={16}/></Primitive.Icon></Primitive.Trigger>
  <Primitive.Portal><Primitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}><Primitive.ScrollUpButton className="select-scroll"><ChevronUp size={16}/></Primitive.ScrollUpButton><Primitive.Viewport>{options.filter(option=>option.props.value!=='').map(option=><Primitive.Item key={String(option.props.value)} value={String(option.props.value)} disabled={option.props.disabled||option.props.value===''} className="select-item"><Primitive.ItemText>{option.props.children}</Primitive.ItemText><Primitive.ItemIndicator><Check size={16}/></Primitive.ItemIndicator></Primitive.Item>)}</Primitive.Viewport><Primitive.ScrollDownButton className="select-scroll"><ChevronDown size={16}/></Primitive.ScrollDownButton></Primitive.Content></Primitive.Portal>
 </Primitive.Root>;
}
