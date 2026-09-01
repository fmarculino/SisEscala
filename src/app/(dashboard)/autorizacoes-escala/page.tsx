import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldQuestion } from 'lucide-react'
import { AutorizacoesEscalaClient } from './AutorizacoesEscalaClient'
import { podeSolicitarCarga, podeAutorizarCarga } from '@/utils/autorizacaoCarga'

/**
 * Autorizações de Escala — os pedidos de Autorização Extraordinária de carga mensal.
 *
 * ⚠️ A tela NÃO filtra as linhas: quem faz isso é `fn_solicitacoes_excecao_carga`, que devolve
 * só o que este usuário pode ver e já traz `pode_avaliar` resolvido linha a linha pela mesma
 * função que a RPC de avaliação usa (`fn_pode_autorizar_excecao_carga`). Mesmo desenho de
 * `podeAvaliar` na avaliação de transferência (28/08/2026): a tela decide o que mostrar, o banco
 * decide o que acontece.
 *
 * ⚠️ O `redirect` aqui é conveniência de navegação, não a defesa. Server Action e RPC são
 * endpoints chamáveis direto (armadilha 12 e 33) — quem recusa de verdade são as RPCs.
 */
export default async function AutorizacoesEscalaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role
  if (!podeSolicitarCarga(role)) redirect('/home')

  /**
   * ⚠️ `new Date().getMonth()` NO SERVIDOR mente (armadilha 12): o container do Coolify roda em
   * UTC, então nas últimas 3 horas do dia 31 a competência inicial já viraria o mês seguinte —
   * e a tela abriria vazia justamente para quem está fechando o mês. A competência de domínio
   * sai do fuso configurado, não do relógio do processo.
   */
  const { data: tzRow } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'timezone')
    .maybeSingle()
  const timezone = typeof tzRow?.valor === 'string' && tzRow.valor ? tzRow.valor : 'America/Sao_Paulo'
  const [anoStr, mesStr] = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl">
          <ShieldQuestion className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Autorizações de Escala
          </h1>
          <p className="text-sm text-zinc-500">
            {podeAutorizarCarga(role)
              ? 'Pedidos de Autorização Extraordinária de carga mensal para decidir.'
              : 'Seus pedidos de Autorização Extraordinária de carga mensal.'}
          </p>
        </div>
      </div>

      <AutorizacoesEscalaClient
        podeAutorizar={podeAutorizarCarga(role)}
        mesInicial={Number(mesStr)}
        anoInicial={Number(anoStr)}
      />
    </div>
  )
}
