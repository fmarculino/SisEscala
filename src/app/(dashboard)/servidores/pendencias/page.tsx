import { createClient } from '@/utils/supabase/server'
import { ShieldAlert } from 'lucide-react'
import { PendenciasCadastroClient } from './PendenciasCadastroClient'

export default async function PendenciasCadastroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  // Fase 5 do plano de validacao de documentos: fn_documentos_invalidos e
  // fn_possiveis_duplicidades_servidor sao SECURITY DEFINER e enxergam a base inteira, sem
  // escopo por unidade/setor - de proposito, e' o ponto delas. A tela precisa do mesmo gate
  // que /usuarios usa, nao da RLS de servidores (que so' restringe por unidade/setor).
  const isAuthorized = profile?.role === 'super_admin' || profile?.role === 'admin'

  if (!isAuthorized) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-zinc-400" />
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Acesso Negado</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Você não tem permissão para ver pendências de cadastro.</p>
        </div>
      </div>
    )
  }

  const [documentosInvalidosRes, duplicidadesRes, semCpfRes, totaisRes, semPisRes] = await Promise.all([
    supabase.rpc('fn_documentos_invalidos'),
    supabase.rpc('fn_possiveis_duplicidades_servidor'),
    supabase
      .from('servidores')
      .select('id, nome, matricula, status, unidades(nome), setores(dicionario_setores(nome))')
      .is('cpf', null)
      .order('nome'),
    supabase.from('servidores').select('id', { count: 'exact', head: true }),
    supabase.from('servidores').select('id', { count: 'exact', head: true }).is('pis_pasep', null),
  ])

  const { count: totalServidores } = totaisRes
  const { count: semPisCount } = semPisRes

  const semCpf = (semCpfRes.data || []).map((s: any) => {
    const setorData = Array.isArray(s.setores) ? s.setores[0] : s.setores
    const dictData = setorData
      ? (Array.isArray(setorData.dicionario_setores) ? setorData.dicionario_setores[0] : setorData.dicionario_setores)
      : null
    const unidadeData = Array.isArray(s.unidades) ? s.unidades[0] : s.unidades
    return {
      id: s.id,
      nome: s.nome,
      matricula: s.matricula,
      status: s.status,
      unidade_nome: unidadeData?.nome || null,
      setor_nome: dictData?.nome || null,
    }
  })

  return (
    <PendenciasCadastroClient
      documentosInvalidos={documentosInvalidosRes.data || []}
      duplicidades={duplicidadesRes.data || []}
      semCpf={semCpf}
      totalServidores={totalServidores || 0}
      semPisCount={semPisCount || 0}
      erroDocumentos={documentosInvalidosRes.error?.message || null}
      erroDuplicidades={duplicidadesRes.error?.message || null}
    />
  )
}
