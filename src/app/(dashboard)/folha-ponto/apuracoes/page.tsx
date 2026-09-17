import { createClient } from '@/utils/supabase/server'
import { montarEscopoGestao, podeGerirMarcacoes, unidadeNoEscopo } from '@/utils/escopoGestao'
import { ApuracoesClient } from './ApuracoesClient'
import Link from 'next/link'

/**
 * Apurações do período (Fase 3 do plano do Mais Médicos).
 *
 * A folha continua mensal. Esta tela emite o documento do período de quem tem fechamento em dia
 * diferente do último dia do mês — hoje, o Mais Médicos (21 a 20).
 */
export default async function ApuracoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: perfil } = await supabase
    .from('profiles')
    .select('role, acesso_todas_unidades, acesso_todos_setores')
    .eq('id', user?.id)
    .single()

  // As unidades que ele vincula, para o escopo por unidade (rh_unidade / admin).
  // Os nomes dos campos são os que `montarEscopoGestao` espera — ele une profile_unidades com as
  // unidades alcançadas por profile_setores (o caso do coordenador sem a unidade-pai).
  const { data: pu } = await supabase
    .from('profile_unidades')
    .select('unidade_id')
    .eq('profile_id', user?.id)

  const { data: ps } = await supabase
    .from('profile_setores')
    .select('setor_id, setores(unidade_id)')
    .eq('profile_id', user?.id)

  const escopo = montarEscopoGestao({
    role: perfil?.role,
    profile_unidades: pu || [],
    profile_setores: ps || [],
  })

  // Emitir apuração é ato de RH — o mesmo público que gere marcações e reabre folha. Quem não
  // alcança vê a razão escrita, nunca uma tela vazia (armadilha 31).
  if (!podeGerirMarcacoes(perfil?.role)) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Apurações do período</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Esta tela emite o documento de apuração de quem tem a folha fechada em dia diferente do
          último dia do mês. Só <strong>RH Geral</strong>, <strong>RH da Unidade</strong>,{' '}
          <strong>Diretor</strong> e <strong>Administrador Geral</strong> emitem — quem lança a
          escala não emite o documento que vai para o pagamento.
        </p>
        <Link href="/folha-ponto" className="mt-4 inline-block text-sm font-semibold text-blue-600">
          Voltar para Folha de Ponto
        </Link>
      </div>
    )
  }

  // ⚠️ Tolera a ausência das tabelas: o deploy é automático e a migration é manual. Sem o guard,
  // esta rota daria erro em produção na janela entre os dois.
  const { error: erroRegimes } = await supabase.from('folha_regimes').select('id').limit(1)
  const { error: erroApuracoes } = await supabase.from('folha_apuracoes').select('id').limit(1)
  const disponivel = !erroRegimes && !erroApuracoes

  const { data: unidadesRaw } = await supabase
    .from('unidades')
    .select('id, nome, ativo')
    .order('nome')

  // Inativa continua no FILTRO (nunca some da listagem), rotulada — ver opcoesAtivas.ts.
  const unidades = ((unidadesRaw as any[]) || [])
    .filter(u => unidadeNoEscopo(escopo, u.id))
    .map(u => ({ id: u.id, nome: u.ativo === false ? `${u.nome} (inativa)` : u.nome }))

  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))

  return (
    <ApuracoesClient
      disponivel={disponivel}
      unidades={unidades}
      mesInicial={agora.getMonth() + 1}
      anoInicial={agora.getFullYear()}
    />
  )
}
