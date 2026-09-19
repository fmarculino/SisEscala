// Reescreve as CTEs caras de fn_auditoria_ponto_servidor. ABORTA se algum trecho nao bater 1x.
//
// 🚨 O que a conferencia mediu em producao: 6799 ms para 8 dias. As PARTES sao rapidas (medido
// contra producao: AFD por identificador 151ms, marcacoes 39ms, escala 53ms). O custo vinha da
// ESTRUTURA -- `ret` chamava fn_batidas_retidas_dia uma vez POR DIA, dentro de um subselect
// escalar, e o planner reavaliava isso a cada juncao de `base`.
import fs from 'fs'
const ARQ = 'supabase/migrations/20260919120000_auditoria_do_ponto_por_servidor.sql'
let s = fs.readFileSync(ARQ, 'utf8')
const N = s.includes('\r\n') ? '\r\n' : '\n'
console.log(`fonte: ${ARQ} (${N === '\r\n' ? 'CRLF' : 'LF'})`)
const sub = (de, para) => {
  const d = de.replace(/\n/g, N), p = para.replace(/\n/g, N)
  const n = s.split(d).length - 1
  if (n !== 1) throw new Error(`esperava 1 ocorrencia, achei ${n}: ${d.slice(0, 70)}`)
  s = s.replace(d, p)
}

// 1) dias MATERIALIZED — impede o planner de reexpandir generate_series a cada junção.
sub(`    WITH dias AS (
        SELECT d::date AS data FROM generate_series(p_inicio, p_fim, interval '1 day') d
    ),`,
`    WITH dias AS MATERIALIZED (
        SELECT d::date AS data FROM generate_series(p_inicio, p_fim, interval '1 day') d
    ),`)

// 2) marc MATERIALIZED e passa a carregar TAMBEM a contagem de retidas.
sub(`    marc AS (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               jsonb_agg(jsonb_build_object(`,
`    marc AS MATERIALIZED (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               -- Retidas derivadas AQUI, no mesmo passo: e a mesma composicao de predicados que
               -- fn_batidas_retidas_dia faz (batida FISICA + desconsiderada), sobre as marcacoes
               -- que esta CTE ja leu. Nao e regra duplicada -- sao as duas mesmas funcoes.
               count(*) FILTER (
                   WHERE public.fn_batida_fisica(m.origem, m.sintetica)
                     AND public.fn_marcacao_desconsiderada(m.id)
               )::integer AS retidas,
               jsonb_agg(jsonb_build_object(`)

// 3) irmao e orfas MATERIALIZED
sub(`    irmao AS (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,`,
`    irmao AS MATERIALIZED (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,`)
sub(`    orfas AS (
        SELECT (a.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data, count(*)::integer AS n`,
`    orfas AS MATERIALIZED (
        SELECT (a.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data, count(*)::integer AS n`)

// 4) a CTE `ret` SAI.
sub(`    ret AS (
        SELECT d.data, (SELECT count(*)::integer FROM public.fn_batidas_retidas_dia(p_servidor_id, d.data)) AS n
          FROM dias d
    ),
    base AS (`,
`    base AS (`)

sub(`               COALESCE(r.n, 0) AS batidas_retidas,`,
`               COALESCE(m.retidas, 0) AS batidas_retidas,`)

sub(`          LEFT JOIN orfas  o ON o.data = dd.data
          LEFT JOIN ret    r ON r.data = dd.data
    )`,
`          LEFT JOIN orfas  o ON o.data = dd.data
    )`)

// 5) a janela: fn_batidas_retidas_dia usa D-1..D+2 (turno que cruza a meia-noite). Aqui a
//    contagem e por DIA CIVIL, que e o que a tela mostra — e isso precisa estar escrito.
sub(`    -- Batidas do proprio servidor no dia civil, com o relogio e o NSR. \`desconsiderada\` diz se
    -- ela esta fora de circulacao AGORA -- a batida existe, esta correta, e a alocacao a filtra.`,
`    -- Batidas do proprio servidor no dia civil, com o relogio e o NSR. \`desconsiderada\` diz se
    -- ela esta fora de circulacao AGORA -- a batida existe, esta correta, e a alocacao a filtra.
    --
    -- ⚠️ A contagem de retidas aqui e por DIA CIVIL, nao pela janela D-1..D+2 de
    -- fn_batidas_retidas_dia. E deliberado: naquela funcao a janela larga existe porque a
    -- ALOCACAO precisa enxergar o turno que cruza a meia-noite; aqui cada batida aparece na
    -- linha do dia em que foi feita, que e' o que quem le a tela espera. Contar a mesma batida
    -- em dois dias faria a tela somar duas vezes o mesmo problema.`)

fs.writeFileSync(ARQ, s)
console.log('  7 substituicoes aplicadas')

const conf = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const c = (conf.match(re) || []).length
  if (c !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${c}`)
  console.log(`  invariante OK: ${rot} (${c})`)
}
// `public.` + parentese: os comentarios CITAM o nome da funcao de proposito (é ela que define a
// regra de "retida"), e contar o nome cru daria 2 sem haver chamada nenhuma.
exigir(/public\.fn_batidas_retidas_dia\(/g, 0, 'a chamada por dia saiu')
exigir(/AS MATERIALIZED/g, 4, 'dias, marc, irmao e orfas materializadas')
exigir(/fn_marcacao_desconsiderada/g, 2, 'predicado de retida: no jsonb e no FILTER')
exigir(/fn_batida_fisica/g, 2, 'predicado de batida fisica: no jsonb e no FILTER')
exigir(/identificador_afd IN \(SELECT unnest\(ids\) FROM ident\)/g, 1, 'busca de orfa preserva o indice')
