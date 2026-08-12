import { createClient } from '@/utils/supabase/server'
import { ShieldAlert } from 'lucide-react'
import { PendenciasCadastroClient } from './PendenciasCadastroClient'

export default async function PendenciasCadastroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, acesso_todas_unidades, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')
    .eq('id', user?.id)
    .single()

  const role = profile?.role
  // RH Geral (role 'rh', 12/08/2026) entra aqui — mesma visão irrestrita de admin/super_admin,
  // sem escopo por unidade. RH da Unidade (role 'rh_unidade') deliberadamente NÃO entra: essa
  // tela ficou definida como RH Geral apenas (nem o menu aparece pra rh_unidade, ver sidebar.tsx).
  const isFullAdmin = role === 'super_admin' || role === 'admin' || role === 'rh'
  // Só coordenador - ass_adm NÃO tem acesso a esta tela (decisão de 12/08/2026, corrigindo
  // 20260812020000 que tinha liberado os dois seguindo o mesmo agrupamento que a sidebar usa
  // pra outras decisões de menu).
  const isCoordEscopo = role === 'coordenador'
  const isAuthorized = isFullAdmin || isCoordEscopo

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

  // Coordenador: só a importação de RH importa pra ele, e só da própria unidade (a
  // RLS nova de importacao_rh_pendentes já filtra isso sozinha - 20260812020000). As demais
  // consultas (documentos inválidos, duplicidades, sem CPF, transferências) são SECURITY
  // DEFINER e enxergam a base inteira de propósito - puladas aqui pra não vazar dado de outra
  // unidade nem gastar consulta à toa.
  if (isCoordEscopo) {
    // Une unidade vinculada direto (profile_unidades) com unidade alcançada só por um setor
    // (profile_setores → setores.unidade_id) — coordenador cujo acesso vem inteiramente de
    // setor vinculado (sem a unidade-pai explicitamente vinculada também) tinha permittedUnidades
    // sempre vazio aqui, mesmo tendo acesso legítimo à unidade pelo próprio setor (mesmo bug que
    // a RLS de importacao_rh_pendentes tinha antes de 20260812050000 — fn_unidade_no_escopo
    // nunca considerou profile_setores, só fn_unidade_alcancavel_por_setor complementa isso).
    const unidadesPorSetor = ((profile as any)?.profile_setores || [])
      .map((ps: any) => (Array.isArray(ps.setores) ? ps.setores[0] : ps.setores)?.unidade_id)
      .filter(Boolean)
    const permittedUnidades = Array.from(new Set([
      ...((profile as any)?.profile_unidades || []).map((pu: any) => pu.unidade_id),
      ...unidadesPorSetor,
    ]))

    async function buscarPendentesRhEscopado() {
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

    const [pendentesRhRes, unidadesRes, setoresRes, cargosRes] = await Promise.all([
      buscarPendentesRhEscopado(),
      // Unidade fora do escopo do coordenador nunca aparece no seletor - promover pra lá é
      // recusado pela RPC de qualquer forma, mas mostrar a opção seria confuso (CLAUDE.md:
      // "direcionar pra onde é mais prático").
      profile?.acesso_todas_unidades
        ? supabase.from('unidades').select('id, nome').order('nome')
        : supabase.from('unidades').select('id, nome').in('id', permittedUnidades.length ? permittedUnidades : ['00000000-0000-0000-0000-000000000000']).order('nome'),
      supabase.from('setores').select('id, unidade_id, dicionario_setores(nome)').order('id'),
      supabase.from('cargos').select('id, nome').eq('ativo', true).order('nome'),
    ])

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
        documentosInvalidos={[]}
        duplicidades={[]}
        semCpf={[]}
        totalServidores={0}
        semPisCount={0}
        erroDocumentos={null}
        erroDuplicidades={null}
        pendentesRh={pendentesRh}
        erroPendentesRh={pendentesRhRes.error?.message || null}
        unidades={unidadesRes.data || []}
        setores={setoresRh}
        cargos={cargosRes.data || []}
        solicitacoesTransferencia={[]}
        erroSolicitacoesTransferencia={null}
        isSuperAdmin={false}
        escopoLimitado
      />
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

  const isSuperAdmin = profile?.role === 'super_admin'

  const [
    documentosInvalidosRes, duplicidadesRes, semCpfRes, totaisRes, semPisRes,
    pendentesRhRes, unidadesRes, setoresRes, cargosRes,
    solicitacoesTransferenciaRes, profilesRes,
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
    // servidores(nome, matricula) é FK simples (sem ambiguidade); unidade/setor de
    // origem/destino são DUAS FKs pra mesma tabela (armadilha 8b do CLAUDE.md) - resolvidas por
    // lookup manual embaixo em vez de embed com dica de constraint, pra não depender do nome
    // exato que o Postgres gerou pra cada FK.
    supabase
      .from('solicitacoes_transferencia_servidor')
      .select('id, servidor_id, unidade_origem_id, setor_origem_id, unidade_destino_id, setor_destino_id, data_transferencia_sugerida, motivo, solicitado_por_id, solicitado_em, servidores(nome, matricula)')
      .eq('status', 'pendente')
      .order('solicitado_em'),
    supabase.from('profiles').select('id, full_name'),
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

  const nomeUnidadePorId = new Map((unidadesRes.data || []).map((u: any) => [u.id, u.nome]))
  const nomeSetorPorId = new Map(setoresRh.map((s) => [s.id, s.nome]))
  const nomePerfilPorId = new Map((profilesRes.data || []).map((p: any) => [p.id, p.full_name]))

  const solicitacoesTransferencia = (solicitacoesTransferenciaRes.data || []).map((s: any) => {
    const servidorData = Array.isArray(s.servidores) ? s.servidores[0] : s.servidores
    return {
      id: s.id,
      servidorId: s.servidor_id,
      servidorNome: servidorData?.nome || '(servidor não encontrado)',
      servidorMatricula: servidorData?.matricula || null,
      unidadeOrigemId: s.unidade_origem_id,
      setorOrigemId: s.setor_origem_id,
      unidadeDestinoId: s.unidade_destino_id,
      setorDestinoId: s.setor_destino_id,
      unidadeOrigemNome: nomeUnidadePorId.get(s.unidade_origem_id) || '—',
      setorOrigemNome: nomeSetorPorId.get(s.setor_origem_id) || '—',
      unidadeDestinoNome: s.unidade_destino_id ? (nomeUnidadePorId.get(s.unidade_destino_id) || '—') : 'A definir pelo RH',
      setorDestinoNome: s.setor_destino_id ? (nomeSetorPorId.get(s.setor_destino_id) || '—') : 'A definir pelo RH',
      dataTransferenciaSugerida: s.data_transferencia_sugerida,
      motivo: s.motivo,
      solicitadoPorNome: nomePerfilPorId.get(s.solicitado_por_id) || '—',
      solicitadoEm: s.solicitado_em,
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
      pendentesRh={pendentesRh}
      erroPendentesRh={pendentesRhRes.error?.message || null}
      unidades={unidadesRes.data || []}
      setores={setoresRh}
      cargos={cargosRes.data || []}
      solicitacoesTransferencia={solicitacoesTransferencia}
      erroSolicitacoesTransferencia={solicitacoesTransferenciaRes.error?.message || null}
      isSuperAdmin={isSuperAdmin}
      escopoLimitado={false}
    />
  )
}
