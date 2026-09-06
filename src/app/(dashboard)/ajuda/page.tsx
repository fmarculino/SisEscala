import packageJson from '../../../../package.json'
import { ManualClient } from './ManualClient'

/**
 * Manual do usuário — SUPORTE → Ajuda.
 *
 * A página é fina de propósito: todo o conteúdo vive em `conteudo/`, como dados. Atualizar o
 * manual é editar aquele diretório — e isso precisa acontecer no MESMO commit da mudança que
 * alterou o sistema (ver `conteudo/index.ts` e a seção "O manual do usuário" no CLAUDE.md).
 *
 * A versão exibida vem do `package.json`, o mesmo número do rodapé do menu: quem lê o manual
 * consegue dizer de qual versão do sistema ele fala.
 */
export default function AjudaPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Manual do Usuário
        </h1>
        <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">
          Como usar o SisEscala, ferramenta por ferramenta. Use a busca para ir direto ao ponto.
        </p>
      </div>

      <ManualClient versao={packageJson.version} />
    </div>
  )
}
