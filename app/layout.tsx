export const metadata = {
  title: "Unify My Chats (MVP)",
  description: "Unifica chats ao vivo de Twitch, YouTube e Kick (leitura apenas).",
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
