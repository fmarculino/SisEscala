import { createClient } from '@/utils/supabase/server'
import { AcessoNegado } from '@/components/AcessoNegado'
import { Radio } from 'lucide-react'
import { MarcacoesClient } from './MarcacoesClient'
import { listarOpcoesFormulario } from './actions'

const ROLES_COM_ACESSO = ['admin', 'super_admin', 'coordenador', 'ass_adm', 'rh']
const ROLES_ADMIN = ['admin', 'super_admin']

export default async function MarcacoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <AcessoNegado />

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !ROLES_COM_ACESSO.includes(profile.role)) return <AcessoNegado />

  const isAdmin = ROLES_ADMIN.includes(profile.role)
  // Dispositivos e terminais são gestão administrativa (infraestrutura de TI); coordenador e
  // RH Geral (12/08/2026 — só vê a tela, não ganhou acesso a device) só usam a aba Pendências,
  // que já é filtrada por escopo dentro de fn_marcacoes_pendentes_revisao (fn_unidade_no_escopo).
  const opcoes = isAdmin
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

      <MarcacoesClient isAdmin={isAdmin} opcoes={opcoes} />
    </div>
  )
}
