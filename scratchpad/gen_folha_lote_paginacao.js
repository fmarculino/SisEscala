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

// --- gerarFolhasEmLote: escalas paginadas
sub(
`    // Fetch scales for this month/year, optionally filtered by unit and sector
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id, setor_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    // Apply security filters at DB level
    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalas, error: escError } = await queryEscalas

    if (escError) throw escError
    if (!escalas || escalas.length === 0) {
      return { error: 'Nenhuma escala ativa encontrada para a competência selecionada.' }
    }
`,
`    // Fetch scales for this month/year, optionally filtered by unit and sector
    // PAGINADO (armadilha 8): sao 1.639 escalas ativas em 09/2026. Sem paginar, "Gerar Todas"
    // geraria as 1.000 primeiras e relataria sucesso — as demais nunca seriam tentadas, e nada
    // na tela diria isso (armadilha 22).
    const montarQueryEscalas = (from: number, to: number) => {
      let q = supabase
        .from('escala_mensal')
        .select('id, servidor_id, unidade_id, setor_id')
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (unidadeId) {
        q = q.eq('unidade_id', unidadeId)
      }
      if (setorId) {
        q = q.eq('setor_id', setorId)
      }

      // Apply security filters at DB level
      q = applyAccessFilters(q, userProfile)
      return q.order('id', { ascending: true }).range(from, to)
    }

    const { linhas: escalas, completo } = await buscarTodasPaginas<any>(montarQueryEscalas, 500)

    if (!escalas || escalas.length === 0) {
      return { error: 'Nenhuma escala ativa encontrada para a competência selecionada.' }
    }
`,
'lote-escalas')

sub(
`    revalidatePath('/folha-ponto')
    return { success: true, message: \`\${geradas} folhas geradas com sucesso. \${erros} falhas.\` }
  } catch (error: any) {
    console.error('Erro na geração em lote:', error)`,
`    revalidatePath('/folha-ponto')
    // Relata o que MUDOU e o que ficou de fora (armadilha 22): busca interrompida no meio nao
    // pode virar "sucesso" sem ressalva.
    const ressalva = completo ? '' : ' ATENÇÃO: a busca das escalas falhou no meio, então nem todas foram tentadas — repita a operação.'
    return { success: true, completo, message: \`\${geradas} folhas geradas com sucesso. \${erros} falhas.\${ressalva}\` }
  } catch (error: any) {
    console.error('Erro na geração em lote:', error)`,
'lote-relato')

// --- autoCorrigirTodasFolhasPonto: folhas paginadas
sub(
`    let query = supabase
      .from('folha_ponto')
      .select('id, mes, ano, registros, escala_mensal(id, unidade_id, setor_id, mes, ano, jornada_id, jornadas(horas_totais, nome, intervalo_minutos))')

    if (mes && ano) {
      query = query.eq('mes', mes).eq('ano', ano)
    }

    const { data: folhas, error } = await query
    if (error) throw error
`,
`    // PAGINADO (armadilha 8): 1.289 folhas em 09/2026 contra o teto de 1.000 do PostgREST —
    // 289 delas nunca eram sequer OLHADAS pela correcao em lote, e o relato nao dizia nada.
    // Pagina menor porque cada linha carrega o jsonb \`registros\` (um objeto por dia do mes).
    const montarQueryFolhas = (from: number, to: number) => {
      let q = supabase
        .from('folha_ponto')
        .select('id, mes, ano, registros, escala_mensal(id, unidade_id, setor_id, mes, ano, jornada_id, jornadas(horas_totais, nome, intervalo_minutos))')

      if (mes && ano) {
        q = q.eq('mes', mes).eq('ano', ano)
      }

      return q.order('id', { ascending: true }).range(from, to)
    }

    const { linhas: folhas, completo } = await buscarTodasPaginas<any>(montarQueryFolhas, 200)
`,
'autocorrigir-busca')

fs.writeFileSync(p,s)
console.log('ok — 3 substituicoes aplicadas')
