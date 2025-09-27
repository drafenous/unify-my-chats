import { MainProvider } from '@/providers/main/main';
import { Lang } from './[lang]/dictionaries';
import './globals.css';
import { LangProvider } from '@/providers/lang/lang';

export const metadata = {
  title: "Unify My Chats",
  description: "Unifica chats ao vivo de Twitch, YouTube e Kick (leitura apenas).",
};

export async function generateStaticParams() {
  return [{ lang: 'pt-BR' }, { lang: 'pt' }, { lang: 'en-US' }, { lang: 'en' }];
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ lang: Lang }>
}>) {
  const { lang } = await params
  return (
    <html lang={lang}>
      <body>
        <LangProvider currentLang={lang}>
          <MainProvider>
            {children}
          </MainProvider>
        </LangProvider>
      </body>
    </html>
  )
}