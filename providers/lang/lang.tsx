'use client';
import { Lang } from '@/app/[lang]/dictionaries';
import React, { createContext, useContext, useState, ReactNode } from 'react';

type LangContextType = {
    lang: Lang;
    setLang: (lang: Lang) => void;
};

const LangContext = createContext<LangContextType | undefined>(undefined);

export const LangProvider = ({ children, currentLang = 'en' }: { children: ReactNode; currentLang?: Lang }) => {
    const [lang, setLang] = useState<Lang>(currentLang);

    return (
        <LangContext.Provider value={{ lang, setLang }}>
            {children}
        </LangContext.Provider>
    );
};

export const useLang = () => {
    const context = useContext(LangContext);
    if (!context) {
        throw new Error('useLang must be used within a LangProvider');
    }
    return context;
};