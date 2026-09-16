const fs=require('fs')
const p='src/utils/autoClose.ts'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const nl=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
function sub(rot,velho,novo){
  const v=nl(velho),n=nl(novo)
  const c=s.split(v).length-1
  if(c!==1){console.error(`ABORT ${rot}: ${c} ocorrencias`);process.exit(1)}
  s=s.replace(v,()=>n)
}

sub('import',
"import { diasComFaltaPendente, promoverFaltasPendentes, isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'",
"import { diasComFaltaPendente, promoverFaltasPendentes, isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'\nimport { buscarTodasPaginas } from '@/utils/paginacao'")

sub('busca',
`    // 1. Fetch all active scales for this month and year
    const { data: scales, error: scaleError } = await supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id, setor_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
    
    if (scaleError) {
      console.error('Erro ao buscar escalas para autoGenerateMissingTimesheets:', scaleError)
      return { success: false, error: scaleError.message }
    }
    
    if (!scales || scales.length === 0) {
      return { success: true, message: 'Nenhuma escala encontrada para este período.' }
    }
    
    // 2. Fetch existing timesheets for this month and year
    const { data: sheets, error: sheetsError } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id')
      .eq('mes', mes)
      .eq('ano', ano)
    
    if (sheetsError) {
      console.error('Erro ao buscar folhas de ponto para autoGenerateMissingTimesheets:', sheetsError)
      return { success: false, error: sheetsError.message }
    }
    
    const sheetsMap = new Set(sheets?.map((s: any) => s.escala_mensal_id) || [])
    `,
`    // 1. Fetch all active scales for this month and year
    //
    // 🚨 AS DUAS BUSCAS PRECISAM VIR INTEIRAS, E AQUI ISSO E DESTRUTIVO — NAO SO INCOMPLETO
    // (armadilha 8). Esta rotina decide "esta escala NAO tem folha" comparando dois conjuntos;
    // o upsert de executeGerarFolhaPonto e por escala_mensal_id, entao uma folha que ficou de
    // fora do corte de 1.000 e REESCRITA como Rascunho. Medido em 15/09/2026 sobre 09/2026
    // (1.639 escalas, 1.289 folhas): o codigo sem paginacao acusaria 390 escalas "sem folha" e
    // 175 delas JA TINHAM folha — 69 em status Gerada voltariam a Rascunho, sozinhas, pelo cron
    // da madrugada. Em 08/2026 (710 x 710) o efeito era zero, e por isso nunca apareceu.
    const { linhas: scales, completo: scalesCompleto } = await buscarTodasPaginas<any>(
      (from, to) => supabase
        .from('escala_mensal')
        .select('id, servidor_id, unidade_id, setor_id')
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)
        .order('id', { ascending: true })
        .range(from, to),
      500
    )

    if (!scales || scales.length === 0) {
      return { success: true, message: 'Nenhuma escala encontrada para este período.' }
    }
    
    // 2. Fetch existing timesheets for this month and year
    const { linhas: sheets, completo: sheetsCompleto } = await buscarTodasPaginas<any>(
      (from, to) => supabase
        .from('folha_ponto')
        .select('escala_mensal_id')
        .eq('mes', mes)
        .eq('ano', ano)
        .order('id', { ascending: true })
        .range(from, to)
    )

    // ⚠️ RECUSA EM VEZ DE SEGUIR COM O QUE VEIO. buscarTodasPaginas devolve o parcial quando uma
    // pagina falha, e decidir "falta folha" sobre conjunto parcial reescreve folha alheia — o
    // default de uma rotina que ESCREVE tem de ser nao fazer nada.
    if (!scalesCompleto || !sheetsCompleto) {
      const msg = 'Busca de escalas/folhas incompleta; geracao automatica abortada para nao sobrescrever folha existente.'
      console.error('autoGenerateMissingTimesheets:', msg)
      return { success: false, error: msg }
    }

    const sheetsMap = new Set(sheets?.map((s: any) => s.escala_mensal_id) || [])
    `)

fs.writeFileSync(p,s)
console.log('ok — 2 substituicoes')
