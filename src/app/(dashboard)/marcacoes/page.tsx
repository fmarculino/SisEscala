import { createClient } from '@/utils/supabase/server'
import { AcessoNegado } from '@/components/AcessoNegado'
import { Radio } from 'lucide-react'
import { MarcacoesClient } from './MarcacoesClient'
import { listarOpcoesFormulario } from './actions'
import { montarEscopoGestao, podeGerirMarcacoes, gerenciaSemEscopo } from '@/utils/escopoGestao'

const ROLES_COM_ACESSO = ['admin', 'super_admin', 'coordenador', 'ass_adm', 'rh', 'rh_unidade']

// Conceder dispensa de registro de ponto. NAO usa `podeGerirMarcacoes`: o Diretor (`admin`) e'
// irrestrito naquele predicado e ficaria com o poder de dispensar qualquer servidor da rede — a
// decisao de 27/08/2026 o exclui nominalmente. Mesma lista das duas RPCs (20260911110000).
const ROLES_AUTORIZACAO_PONTO = ['super_admin', 'rh', 'rh_unidade']

export default async function MarcacoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <AcessoNegado />

  // `profile_setores` entra junto porque um perfil pode alcancar a unidade so por um setor
  // vinculado (fn_unidade_alcancavel_por_setor) — sem isso ele abriria a tela vazia.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')
    .eq('id', user.id)
    .single()

  if (!profile || !ROLES_COM_ACESSO.includes(profile.role)) return <AcessoNegado />

  const escopo = montarEscopoGestao(profile)

  // Infraestrutura (Terminais Locais, Dispositivos REP, Higiene, Importar por Pendrive) deixou de
  // ser exclusividade de Administrador Geral / Diretor em 10/09/2026: RH Geral em qualquer
  // unidade, RH da Unidade nas dele. Quem recorta o QUE cada um ve sao as actions e, atras
  // delas, `fn_escopo_gestao_alcanca` — esta flag decide so quais abas aparecem.
  const podeGerir = podeGerirMarcacoes(profile.role)
  const podeAutorizar = ROLES_AUTORIZACAO_PONTO.includes(profile.role)

  // Coordenador e Ass. Administrativo continuam sem as abas de infraestrutura: para eles o
  // formulario nao tem uso, e carregar unidades/setores/coordenadores seria consulta a toa.
  const opcoes = podeGerir
    ? await listarOpcoesFormulario()
    : { unidades: [], setores: [], coordenadores: [] }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl">
          <Radio className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Marcações</h1>
          <p className="text-sm text-zinc-500">Relógios de ponto (REP), terminais locais e pendências de revisão.</p>
        </div>
      </div>

      <MarcacoesClient
        podeGerir={podeGerir}
        podeAutorizar={podeAutorizar}
        escopoLimitado={podeGerir && !gerenciaSemEscopo(profile.role)}
        opcoes={opcoes}
      />
    </div>
  )
}
