import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Heading } from '../components/workspace';
export default function NotFoundPage(){return <><Heading title="页面不存在" desc="请检查地址，或返回工作台继续使用。"/><Button asChild className="primary"><Link to="/query">返回工作台</Link></Button></>;}
