import { Feed } from '@/components/home/feed/feed';
import { Header } from '@/components/home/header/header';
import { getDictionary, Lang } from '../dictionaries';


export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const texts = await getDictionary(lang);

  return (
    <div className="container">
      <Header texts={texts} />
      <Feed texts={texts} />
    </div>
  );
}
