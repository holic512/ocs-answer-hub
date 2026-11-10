import * as Label from '@radix-ui/react-label';
import {cloneElement,createContext,isValidElement,useContext,useId,type ReactElement,type ReactNode} from 'react';
const FieldContext=createContext<{id?:string;'aria-invalid'?:boolean;'aria-describedby'?:string}>({});
export function useFieldControl(){return useContext(FieldContext);}
export function FormField({label,hint,error,children}:{label:string;hint?:string;error?:string;children:ReactNode}){
 const id=useId(),description=`${id}-description`;
 return <FieldContext.Provider value={{id,'aria-invalid':Boolean(error),'aria-describedby':hint||error?description:undefined}}><div className="field"><Label.Root htmlFor={id}>{label}</Label.Root>{isValidElement(children)?cloneElement(children as ReactElement<any>,{id,'aria-invalid':Boolean(error),'aria-describedby':hint||error?description:undefined}):children}{(error||hint)&&<small id={description} className={error?'field-error':''}>{error||hint}</small>}</div></FieldContext.Provider>;
}
export function FormActions({children}:{children:ReactNode}){return <div className="form-actions">{children}</div>;}
