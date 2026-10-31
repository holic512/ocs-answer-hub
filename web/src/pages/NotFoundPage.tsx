import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Heading } from '../components/workspace';
export default function NotFoundPage(){return <><Heading title="页面不存在" desc="请检查地址，或返回概览继续使用。"/><Button asChild className="primary"><Link to="/overview">返回概览</Link></Button></>;}
