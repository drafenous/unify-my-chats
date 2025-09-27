"server-only";

export const langs = {
  en: "en",
  enUS: "en-US",
  pt: "pt",
  ptBR: "pt-BR",
} as const;

export const defaultLocale = langs.en;

export type Lang = (typeof langs)[keyof typeof langs];

const dictionaries = {
  [langs.en]: () =>
    import("../dictionaries/en.json").then((module) => module.default),
  [langs.enUS]: () =>
    import("../dictionaries/en.json").then((module) => module.default),
  [langs.pt]: () =>
    import("../dictionaries/pt.json").then((module) => module.default),
  [langs.ptBR]: () =>
    import("../dictionaries/pt.json").then((module) => module.default),
};

export const getDictionary = async (locale?: Lang) =>
  dictionaries[locale || defaultLocale]?.() || dictionaries[defaultLocale]();
