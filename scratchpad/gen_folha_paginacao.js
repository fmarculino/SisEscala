const fs=require('fs')
const p='src/app/(dashboard)/folha-ponto/actions.ts'
let s=fs.readFileSync(p,'utf8')
const crlf=t=>t.replace(/\n/g,'\r\n')
function sub(velho,novo,rot){
  const v=crlf(velho), n=crlf(novo)
  const c=s.split(v).length-1
  if(c!==1){console.error(`ABORT ${rot}: ${c} ocorrencias (esperado 1)`);process.exit(1)}
  s=s.replace(v,()=>n)
}

sub(
"import { normalizarNomeJornada } from '@/utils/folha/nomeJornada'",
"import { normalizarNomeJornada } from '@/utils/folha/nomeJornada'\nimport { buscarTodasPaginas } from '@/utils/paginacao'",
'import')

sub(
`    // 1. Fetch active scales in this sector/unit/month/year to find all servers who have scales for this period
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, status, servidor_id, unidade_id, setor_id, status, jornada_id, jornadas(nome), servidores(id, nome, matricula, cargo)')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalasMes, error: escError } = await queryEscalas
    if (escError) throw escError

    if (!escalasMes || escalasMes.length === 0) {
      return { servidores: [] }
    }
`,
`    // 1. Fetch active scales in this sector/unit/month/year to find all servers who have scales for this period
    // PAGINADO (armadilha 8): 1.639 escalas ativas em 09/2026, e perfil escopado por varias
    // unidades chama esta action sem unidadeId. Sem paginar, servidor some da lista em silencio.
    const montarQueryEscalas = (from: number, to: number) => {
      let q = supabase
        .from('escala_mensal')
        .select('id, status, servidor_id, unidade_id, setor_id, status, jornada_id, jornadas(nome), servidores(id, nome, matricula, cargo)')
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (unidadeId) {
        q = q.eq('unidade_id', unidadeId)
      }
      if (setorId) {
        q = q.eq('setor_id', setorId)
      }

      q = applyAccessFilters(q, userProfile)
      return q.order('id', { ascending: true }).range(from, to)
    }

    const { linhas: escalasMes, completo: escalasCompletas } = await buscarTodasPaginas<any>(montarQueryEscalas, 500)

    if (!escalasMes || escalasMes.length === 0) {
      return { servidores: [], completo: escalasCompletas }
    }
`,
'escalas')

sub(
`    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo')
      .eq('mes', mes)
      .eq('ano', ano)

    if (folhaError) throw folhaError
`,
`    //
    // PAGINADO — ERA ESTE O BUG DO "GEREI E CONTINUA NAO GERADA" (armadilha 8). Em 09/2026
    // existem 1.289 folhas e o PostgREST devolvia 1.000, EM SILENCIO: as 289 restantes (medidas
    // em 15/09/2026, espalhadas por 19 unidades) estavam no banco com status Gerada e a tela as
    // exibia como "Nao Gerada". Clicar em Gerar funcionava, o upsert gravava, a mensagem de
    // sucesso era verdadeira — e a linha voltava igual, para sempre. O .order('id') NAO e
    // cosmetico: sem ordem estavel o Postgres pode repetir linha numa pagina e omitir na outra.
    //
    // O filtro por unidade/setor via embed !inner reduz o universo antes de paginar (50 linhas
    // na USF Hiroshi Matsuda em vez de 1.289) — conferido EXECUTANDO contra producao, porque
    // embed so se prova executando (armadilha 8b).
    const montarQueryFolhas = (from: number, to: number) => {
      const precisaEscopo = !!unidadeId || !!setorId
      let q = supabase
        .from('folha_ponto')
        .select(
          precisaEscopo
            ? 'id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo, escala_mensal!inner(unidade_id, setor_id)'
            : 'id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo'
        )
        .eq('mes', mes)
        .eq('ano', ano)

      if (unidadeId) {
        q = q.eq('escala_mensal.unidade_id', unidadeId)
      }
      if (setorId) {
        q = q.eq('escala_mensal.setor_id', setorId)
      }

      return q.order('id', { ascending: true }).range(from, to)
    }

    const { linhas: folhas, completo: folhasCompletas } = await buscarTodasPaginas<any>(montarQueryFolhas)
`,
'folhas')

sub(
`    result.sort((a, b) => a.nome.localeCompare(b.nome))

    return { servidores: result }
  } catch (error: any) {
    console.error('Erro em getServidoresFolhaPonto:', error)`,
`    result.sort((a, b) => a.nome.localeCompare(b.nome))

    // Paginacao interrompida por erro devolve o que veio (ver buscarTodasPaginas). Aqui isso
    // significa STATUS DE FOLHA ERRADO na linha, nao apenas um total menor — por isso a tela
    // precisa saber e avisar (armadilha 22).
    return { servidores: result, completo: escalasCompletas && folhasCompletas }
  } catch (error: any) {
    console.error('Erro em getServidoresFolhaPonto:', error)`,
'retorno')

fs.writeFileSync(p,s)
console.log('ok — 4 substituicoes aplicadas')
