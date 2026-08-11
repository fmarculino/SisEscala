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

  // importacao_rh_pendentes pode passar de 1000 linhas (3.362 em 10/08/2026) - PostgREST corta
  // em 1000 silenciosamente (armadilha 8 do CLAUDE.md), então pagina por Range em vez de um
  // único .select(). Só os campos que a lista e o formulário de conclusão usam - o resto
  // (dados_complementares) fica no banco, fn_promover_pendencia_rh lê de lá direto.
  async function buscarPendentesRh() {
    const linhas: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('importacao_rh_pendentes')
        .select('id, nome, matricula, classificacao, cargo_sugerido, unidade_id, departamento_origem, vinculo_adicional_de_cpf, criado_em, unidades(nome)')
        .is('promovido_em', null)
        .order('nome')
        .range(from, from + 999)
      if (error) return { data: null, error }
      linhas.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return { data: linhas, error: null }
  }

  const [
    documentosInvalidosRes, duplicidadesRes, semCpfRes, totaisRes, semPisRes,
    pendentesRhRes, unidadesRes, setoresRes, cargosRes,
  ] = await Promise.all([
    supabase.rpc('fn_documentos_invalidos'),
    supabase.rpc('fn_possiveis_duplicidades_servidor'),
    supabase
      .from('servidores')
      .select('id, nome, matricula, status, unidades(nome), setores(dicionario_setores(nome))')
      .is('cpf', null)
      .order('nome'),
    supabase.from('servidores').select('id', { count: 'exact', head: true }),
    supabase.from('servidores').select('id', { count: 'exact', head: true }).is('pis_pasep', null),
    buscarPendentesRh(),
    supabase.from('unidades').select('id, nome').order('nome'),
    supabase.from('setores').select('id, unidade_id, dicionario_setores(nome)').order('id'),
    supabase.from('cargos').select('id, nome').eq('ativo', true).order('nome'),
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

  const pendentesRh = (pendentesRhRes.data || []).map((p: any) => {
    const unidadeData = Array.isArray(p.unidades) ? p.unidades[0] : p.unidades
    return {
      id: p.id,
      nome: p.nome,
      matricula: p.matricula,
      classificacao: p.classificacao,
      cargo_sugerido: p.cargo_sugerido,
      unidade_id: p.unidade_id,
      unidade_nome: unidadeData?.nome || null,
      departamento_origem: p.departamento_origem,
      vinculo_adicional_de_cpf: p.vinculo_adicional_de_cpf,
    }
  })

  const setoresRh = (setoresRes.data || []).map((s: any) => {
    const dictData = Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores
    return { id: s.id, unidade_id: s.unidade_id, nome: dictData?.nome || 'SETOR SEM NOME' }
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
      pendentesRh={pendentesRh}
      erroPendentesRh={pendentesRhRes.error?.message || null}
      unidades={unidadesRes.data || []}
      setores={setoresRh}
      cargos={cargosRes.data || []}
    />
  )
}
