const fs=require('fs')
const p='src/app/api/folha-ponto/regerar-competencia/route.ts'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const nl=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
function sub(rot,velho,novo){
  const v=nl(velho),n=nl(novo)
  const c=s.split(v).length-1
  if(c!==1){console.error(`ABORT ${rot}: ${c}`);process.exit(1)}
  s=s.replace(v,()=>n)
}

sub('import',
"import { executeGerarFolhaPonto } from '@/app/(dashboard)/folha-ponto/actions'",
"import { executeGerarFolhaPonto } from '@/app/(dashboard)/folha-ponto/actions'\nimport { buscarTodasPaginas } from '@/utils/paginacao'")

sub('buscas',
`    let q = supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
    if (unidadeId) q = q.eq('unidade_id', unidadeId)
    const { data: escalas, error: errEscalas } = await q
    if (errEscalas) throw errEscalas
    if (!escalas || escalas.length === 0) {
      return NextResponse.json({ error: 'Nenhuma escala ativa nesta competência.' }, { status: 404 })
    }

    const { data: folhas, error: errFolhas } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, status')
      .eq('mes', mes)
      .eq('ano', ano)
    if (errFolhas) throw errFolhas
    const statusPorEscala = new Map<string, string>(
      (folhas || []).map((f: any) => [f.escala_mensal_id, f.status])
    )`,
`    // 🚨 PAGINADO, E INCOMPLETO ABORTA (armadilha 8). O alvo e escolhido por AUSENCIA de folha
    // (\`st === undefined\`): folha que ficasse fora do corte de 1.000 do PostgREST seria lida
    // como inexistente e REESCRITA como Rascunho, rebaixando Gerada/Revisada. Em 09/2026 sao
    // 1.639 escalas e 1.289 folhas — acima do teto nas duas pontas.
    const { linhas: escalas, completo: escalasCompleto } = await buscarTodasPaginas<any>(
      (from, to) => {
        let q = supabase
          .from('escala_mensal')
          .select('id, servidor_id, unidade_id')
          .eq('mes', mes)
          .eq('ano', ano)
          .eq('ativo', true)
        if (unidadeId) q = q.eq('unidade_id', unidadeId)
        return q.order('id', { ascending: true }).range(from, to)
      },
      500
    )
    if (!escalas || escalas.length === 0) {
      return NextResponse.json({ error: 'Nenhuma escala ativa nesta competência.' }, { status: 404 })
    }

    const { linhas: folhas, completo: folhasCompleto } = await buscarTodasPaginas<any>(
      (from, to) => supabase
        .from('folha_ponto')
        .select('escala_mensal_id, status')
        .eq('mes', mes)
        .eq('ano', ano)
        .order('id', { ascending: true })
        .range(from, to)
    )

    if (!escalasCompleto || !folhasCompleto) {
      return NextResponse.json(
        { error: 'Busca de escalas/folhas incompleta; operacao abortada para nao sobrescrever folha existente.' },
        { status: 503 }
      )
    }

    const statusPorEscala = new Map<string, string>(
      (folhas || []).map((f: any) => [f.escala_mensal_id, f.status])
    )`)

fs.writeFileSync(p,s)
console.log('ok — 2 substituicoes')
