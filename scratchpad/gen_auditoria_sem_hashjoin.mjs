// Tira os JOINs com tabelas gigantes de dentro das CTEs de batidas. ABORTA se algo nao bater 1x.
//
// 🚨 Diagnostico completo, medido pela propria conferencia em producao (19/09/2026):
//     1 dia = 9 ms · 8 dias = 5211 ms · 30 dias = 6688 ms · consulta de orfas isolada = 1 ms
// A orfa esta inocente. E com 1 dia o servidor de teste tem ZERO marcacoes -- por isso 9 ms.
// O custo aparece junto com as primeiras marcacoes e depois quase nao cresce (23 -> 97 marcacoes
// custa 5,2s -> 6,7s): custo FIXO grande + variavel pequeno e a assinatura de um HASH JOIN.
//
// As tabelas: marcacoes_ponto tem 3.491.055 linhas e rep_afd_registros 3.170.000. Com poucas
// linhas o planner faz nested loop por PK; passando de um limiar ele decide construir um hash da
// tabela inteira -- ~5s, exatamente o degrau medido.
//
// A correcao e' subquery escalar correlacionada: ela FORCA o lookup por PK, linha a linha, e o
// plano deixa de depender da estimativa de cardinalidade.
//
// ⚠️ Isto NAO contradiz a correcao anterior (que TIROU uma subquery de `orfas`). Sao coisas
// opostas: la a subquery escondia os VALORES de um filtro e matava o indice; aqui a subquery
// correlacionada por CHAVE PRIMARIA e o que garante o indice. Subquery em filtro: ruim.
// Subquery escalar por PK: boa.
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

// ---------------------------------------------------------------- marc
sub(`    marc AS MATERIALIZED (
        SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               -- Retidas derivadas AQUI, no mesmo passo: e a mesma composicao de predicados que
               -- fn_batidas_retidas_dia faz (batida FISICA + desconsiderada), sobre as marcacoes
               -- que esta CTE ja leu. Nao e regra duplicada -- sao as duas mesmas funcoes.
               count(*) FILTER (
                   WHERE public.fn_batida_fisica(m.origem, m.sintetica)
                     AND public.fn_marcacao_desconsiderada(m.id)
               )::integer AS retidas,
               jsonb_agg(jsonb_build_object(
                   'hora', to_char(m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                   'origem', m.origem,
                   'relogio', d.nome,
                   'nsr', a.nsr,
                   'desconsiderada', public.fn_marcacao_desconsiderada(m.id),
                   'fisica', public.fn_batida_fisica(m.origem, m.sintetica)
               ) ORDER BY m.ocorrido_em) AS batidas
          FROM public.marcacoes_ponto m
          LEFT JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
          LEFT JOIN public.rep_afd_registros a ON a.id = m.afd_registro_id
         WHERE m.servidor_id = p_servidor_id
           AND m.ocorrido_em >= p_inicio
           AND m.ocorrido_em <  (p_fim + 1)
         GROUP BY 1
    ),`,
`    -- As marcacoes CRUAS do periodo. Materializada e sem JOIN nenhum de proposito: e a lista
    -- pequena (dezenas de linhas) que as demais consultas vao usar.
    --
    -- ⚠️ Cada predicado e avaliado UMA vez por marcacao, nao duas. Na versao anterior
    -- fn_marcacao_desconsiderada aparecia no FILTER e dentro do jsonb_build_object, dobrando as
    -- chamadas -- e ela varre marcacoes_tratamentos duas vezes por chamada.
    marc_base AS MATERIALIZED (
        SELECT m.id, m.ocorrido_em, m.origem, m.dispositivo_id, m.afd_registro_id,
               public.fn_batida_fisica(m.origem, m.sintetica)   AS fisica,
               public.fn_marcacao_desconsiderada(m.id)          AS desconsiderada
          FROM public.marcacoes_ponto m
         WHERE m.servidor_id = p_servidor_id
           AND m.ocorrido_em >= p_inicio
           AND m.ocorrido_em <  (p_fim + 1)
    ),
    marc AS MATERIALIZED (
        SELECT (b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
               -- Retidas: a mesma composicao de predicados que fn_batidas_retidas_dia faz (batida
               -- FISICA + desconsiderada), sobre o que marc_base ja resolveu. Nao e regra
               -- duplicada -- sao as duas mesmas funcoes.
               count(*) FILTER (WHERE b.fisica AND b.desconsiderada)::integer AS retidas,
               jsonb_agg(jsonb_build_object(
                   'hora', to_char(b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                   'origem', b.origem,
                   -- 🚨 Subquery escalar por CHAVE PRIMARIA, nunca LEFT JOIN. rep_afd_registros
                   -- tem 3,17 milhoes de linhas: com JOIN o planner passa a construir um hash da
                   -- tabela inteira assim que estima mais que um punhado de marcacoes, e foi isso
                   -- que fez a funcao saltar de 9 ms para 5.211 ms. Correlacionada por PK, o
                   -- acesso e sempre index scan.
                   'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = b.dispositivo_id),
                   'nsr', (SELECT a.nsr FROM public.rep_afd_registros a WHERE a.id = b.afd_registro_id),
                   'desconsiderada', b.desconsiderada,
                   'fisica', b.fisica
               ) ORDER BY b.ocorrido_em) AS batidas
          FROM marc_base b
         GROUP BY 1
    ),`)

// ---------------------------------------------------------------- irmao
sub(`          FROM public.marcacoes_ponto m
          JOIN public.servidores i ON i.id = m.servidor_id
          LEFT JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
         WHERE m.servidor_id = ANY (COALESCE(v_irmaos, ARRAY[]::uuid[]))`,
`          FROM public.marcacoes_ponto m
         WHERE m.servidor_id = ANY (COALESCE(v_irmaos, ARRAY[]::uuid[]))`)

sub(`                   'matricula', i.matricula,
                   'relogio', d.nome`,
`                   'matricula', (SELECT i.matricula FROM public.servidores i WHERE i.id = m.servidor_id),
                   'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = m.dispositivo_id)`)

fs.writeFileSync(ARQ, s)
console.log('  3 substituicoes aplicadas')

const c = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const g = (c.match(re) || []).length
  if (g !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${g}`)
  console.log(`  invariante OK: ${rot} (${g})`)
}
exigir(/LEFT JOIN public\.rep_afd_registros/g, 0, 'nenhum JOIN com a tabela de 3,17M linhas')
exigir(/LEFT JOIN public\.dispositivos_rep/g, 0, 'nenhum JOIN de dispositivo nas CTEs de batida')
exigir(/public\.fn_marcacao_desconsiderada\(m\.id\)/g, 1, 'predicado de retida avaliado UMA vez por marcacao')
exigir(/public\.fn_batida_fisica\(m\.origem, m\.sintetica\)/g, 1, 'predicado de batida fisica avaliado UMA vez')
exigir(/AS MATERIALIZED/g, 5, 'dias, marc_base, marc, irmao e orfas materializadas')
exigir(/= ANY \(v_ids_afd\)/g, 1, 'orfa continua por array resolvido')
