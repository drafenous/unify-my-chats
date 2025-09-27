import { LangProvider } from '@/providers/lang/lang';
import { MainProvider } from '@/providers/main/main';
import { ReactNode } from 'react';
import { Lang } from '../dictionaries';
import '../globals.css';

export const dynamicParams = false;

export async function generateStaticParams() {
    return [{ lang: 'pt-BR' }, { lang: 'pt' }, { lang: 'en-US' }, { lang: 'en' }];
}

export default async function RootLayout({
    children,
    params,
}: {
    children: ReactNode;
    params: Promise<{ lang: string }>;
}) {
    const lang = (await params).lang as Lang;

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
    );
}
