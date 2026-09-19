'use server'

import { createAdminClient } from '@/utils/supabase/server'
import { montarEscopoGestao, podeGerirMarcacoes, filtrarPorUnidade, ERRO_SEM_GESTAO_MARCACOES } from '@/utils/escopoGestao'
import { createClient } from '@/utils/supabase/server'
import { buscarTodasPaginas } from '@/utils/paginacao'

/**
 * Investigação do ponto de UMA pessoa. Responde "bati e estou com traço vermelho — o que houve?".
 *
 * 🚨 SOMENTE LEITURA. Nenhuma action aqui escreve, e isso é desenho: as correções já existem
 * (Preencher pelas Batidas, Restaurar Batidas, correção de batida real, lançamento de escala) e
 * cada uma tem a prévia e o guard dela. Um segundo caminho de escrita sobre ponto é o padrão que
 * este projeto já pagou caro três vezes.
 *
 * ⚠️ Server action é um POST cujo id sai no bundle (armadilha 33) — o guard de papel está aqui,
 * e o de escopo por servidor está DENTRO de `fn_auditoria_ponto_servidor`. A tela não é defesa.
 */

async function exigirGestao() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autorizado.')

  const admin = await createAdminClient()
  const { data: perfil } = await admin
    .from('profiles')
    .select('role, acesso_todas_unidades, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')
    .eq('id', user.id)
    .single()

  // `montarEscopoGestao` recebe o perfil CRU (ele mesmo lê profile_unidades/profile_setores) —
  // é a fonte única da armadilha 62, e remontar o objeto aqui criaria uma segunda leitura da
  // mesma regra, livre para divergir.
  const escopo = montarEscopoGestao(perfil)
  if (!podeGerirMarcacoes(escopo.role)) throw new Error(ERRO_SEM_GESTAO_MARCACOES)
  return { escopo, admin }
}

export type ServidorEncontrado = {
  id: string
  nome: string
  matricula: string | null
  cpf: string | null
  unidade_nome: string | null
  status: string | null
}

/**
 * Busca por nome, matrícula ou CPF.
 *
 * ⚠️ O recorte é `filtrarPorUnidade` sobre a LOTAÇÃO, e é deliberadamente frouxo: quem investiga
 * precisa achar a pessoa antes de saber onde ela está escalada. Quem de fato recusa é a RPC, que
 * confere o escopo contra lotação ∪ escala do período — a união que preserva o Servidor Externo.
 */
export async function buscarServidorParaInvestigar(termo: string): Promise<ServidorEncontrado[]> {
  const { escopo, admin } = await exigirGestao()
  const t = (termo || '').trim()
  if (t.length < 3) return []

  const digitos = t.replace(/\D/g, '')
  // `or` do PostgREST: nome parecido, matrícula exata, ou CPF/PIS por dígitos. O `%` no meio do
  // nome é o que faz "maria silva" achar "MARIA DA SILVA".
  const filtros = [`nome.ilike.%${t.replace(/[,()]/g, '')}%`, `matricula.ilike.%${t}%`]
  if (digitos.length >= 6) {
    filtros.push(`cpf.ilike.%${digitos}%`)
    filtros.push(`pis_pasep.ilike.%${digitos}%`)
  }

  const { data, error } = await admin
    .from('servidores')
    .select('id, nome, matricula, cpf, status, unidade_id, unidades(nome)')
    .or(filtros.join(','))
    .order('nome')
    .limit(40)
  if (error) throw new Error(error.message)

  return filtrarPorUnidade(escopo, data || [], (s: any) => s.unidade_id).map((s: any) => ({
    id: s.id,
    nome: s.nome,
    matricula: s.matricula,
    // Só os 3 últimos dígitos: a lista é para escolher entre homônimos, não para exibir documento.
    cpf: s.cpf ? `•••${String(s.cpf).replace(/\D/g, '').slice(-3)}` : null,
    unidade_nome: s.unidades?.nome || null,
    status: s.status,
  }))
}

export type DiaAuditado = {
  data: string
  turno_codigo: string | null
  categoria: string | null
  unidade_nome: string | null
  setor_nome: string | null
  entrada_em: string | null
  int_saida_em: string | null
  int_retorno_em: string | null
  saida_em: string | null
  passos_preenchidos: number
  passos_esperados: number
  batidas: { hora: string; origem: string; relogio: string | null; nsr: number | null; desconsiderada: boolean; fisica: boolean }[]
  batidas_retidas: number
  batidas_irmao: { hora: string; matricula: string | null; relogio: string | null }[]
  afd_sem_marcacao: number
  diagnostico: string
  explicacao: string
}

export async function auditarPontoServidor(
  servidorId: string,
  inicio: string,
  fim: string,
): Promise<{ dias: DiaAuditado[]; error?: string }> {
  const { admin } = await exigirGestao()

  const { data, error } = await admin.rpc('fn_auditoria_ponto_servidor', {
    p_servidor_id: servidorId,
    p_inicio: inicio,
    p_fim: fim,
  })
  // ⚠️ A RPC levanta `insufficient_privilege` para servidor fora do escopo. Devolver a mensagem
  // dela, e não uma genérica: quem investiga precisa saber se o problema é permissão ou dado.
  if (error) return { dias: [], error: error.message }
  return { dias: (data || []) as DiaAuditado[] }
}

/**
 * Estado da coleta dos relógios das unidades onde a pessoa esteve no período.
 *
 * 🚨 É o que fecha o diagnóstico 🔴 "não chegou". Sem isto, "nenhuma batida no dia" é
 * indistinguível de falta — e foi exatamente essa dúvida que, em 18/09/2026, levou 38 horas para
 * ser respondida. Com isto, a tela diz "o relógio da unidade tem N batidas ainda não coletadas".
 */
export async function coletaDasUnidadesDoServidor(servidorId: string): Promise<any[]> {
  const { admin } = await exigirGestao()

  const [{ data: srv }, escalas] = await Promise.all([
    admin.from('servidores').select('unidade_id').eq('id', servidorId).maybeSingle(),
    buscarTodasPaginas<{ unidade_id: string }>((de, ate) =>
      admin.from('escala_mensal').select('unidade_id').eq('servidor_id', servidorId).order('id').range(de, ate)),
  ])

  const unidades = new Set<string>()
  if (srv?.unidade_id) unidades.add(srv.unidade_id)
  for (const e of escalas.linhas) if (e.unidade_id) unidades.add(e.unidade_id)
  if (unidades.size === 0) return []

  const { data, error } = await admin.rpc('fn_vigilancia_coleta_parque')
  if (error) return []
  // Só os relógios com sinal, e só das unidades dessa pessoa: a lista inteira do parque aqui
  // seria ruído dentro de uma tela que responde sobre UMA pessoa.
  return (data || []).filter((l: any) => unidades.has(l.unidade_id) && Number(l.severidade) > 0)
}
