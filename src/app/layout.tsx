import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { DialogProvider } from "@/components/ui/DialogProvider";
import { createClient } from "@/utils/supabase/server";
import { TIMEZONE_PADRAO, definirTimezone } from "@/utils/horario";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SisEscala - Gestão de Escalas Municipais",
  description: "Sistema de Gestão e Auditoria de Escalas Municipais",
};

/**
 * O fuso do sistema vem de `configuracoes_globais.timezone` e é publicado aqui, no HTML.
 *
 * Por que no layout RAIZ e não num provider: ele cobre também as telas anônimas — /login,
 * /presenca, /presenca-local, /consultar-escala, /sobreaviso/[token] — que são justamente onde
 * o horário aparece para o servidor público. A leitura é liberada pela policy
 * "Portal access to public configs" (migration 20260823110000).
 *
 * Publicar no HTML em vez de buscar no cliente evita o pisca de renderizar a hora no fuso errado
 * antes de a configuração chegar. Falhou a leitura? Cai em TIMEZONE_PADRAO, que é o valor real
 * de produção — nunca no fuso da máquina de quem abriu a tela.
 */
async function obterTimezoneConfigurado(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("configuracoes_globais")
      .select("valor")
      .eq("chave", "timezone")
      .maybeSingle();
    const valor = data?.valor;
    const tz = typeof valor === "string" ? valor : null;
    // Um fuso inválido quebraria toda formatação da página. Confere antes de publicar.
    if (tz) {
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
      return tz;
    }
  } catch {
    /* sem sessão, sem rede, ou fuso inválido: cai no padrão abaixo */
  }
  return TIMEZONE_PADRAO;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const timezone = await obterTimezoneConfigurado();
  definirTimezone(timezone);

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/*
          Precisa rodar ANTES de qualquer componente formatar hora, por isso vai no <head> e não
          num efeito. JSON.stringify escapa o valor — ele vem do banco.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SISESCALA_TZ__=${JSON.stringify(timezone)};`,
          }}
        />
      </head>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <DialogProvider>
            {children}
          </DialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
