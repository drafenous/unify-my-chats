export const metadata = {
  title: "Live Chat Unifier (MVP)",
  description: "Unifica chats ao vivo de Twitch e YouTube (leitura apenas).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>
        {children}
      </body>
    </html>
  );
}
