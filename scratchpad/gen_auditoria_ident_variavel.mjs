// Tira os identificadores do AFD e os irmaos de dentro da consulta: viram VARIAVEIS, resolvidas
// antes do RETURN QUERY. ABORTA se algum trecho nao bater exatamente 1x.
//
// 🚨 Medido em producao (conferencia da propria migration, 19/09/2026):
//     1 dia = 10 ms · 8 dias = 6414 ms · 30 dias = 5588 ms
// Nao e' proporcional -- 8 dias custa MAIS que 30. Custo quase fixo a partir de certo ponto e'
// assinatura de TROCA DE PLANO: o planner desiste do indice e varre `rep_afd_registros` inteira
// (3,17 milhoes de linhas, ~6s). A mesma consulta com valores LITERAIS levava 46 ms.
//
// A causa era a subquery: `identificador_afd IN (SELECT unnest(ids) FROM ident)` esconde os
// valores do planner, que perde a estimativa e abandona `idx_afd_identificador`. Com um array
// ja resolvido em variavel, ele volta a usar o indice.
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

// 1) variaveis novas
sub(`DECLARE
    v_unidades uuid[];
BEGIN`,
`DECLARE
    v_unidades uuid[];
    -- 🚨 Resolvidos ANTES da consulta, de proposito. Como subquery dentro do WHERE eles escondem
    -- os valores do planner, que perde a estimativa e troca o indice por uma varredura de
    -- \`rep_afd_registros\` (3,17 milhoes de linhas): medido, 10 ms com 1 dia contra 6.414 ms com 8.
    -- Com o array ja resolvido, \`= ANY(...)\` volta a usar idx_afd_identificador.
    v_ids_afd  text[];
    v_irmaos   uuid[];
BEGIN`)

// 2) preencher as variaveis logo depois do guard de escopo
sub(`    RETURN QUERY
    WITH dias AS MATERIALIZED (`,
`    -- Identificadores deste servidor no AFD. A conversao e \`lpad(digitos, 12, '0')\`, a mesma que
    -- fn_enfileirar_cadastros_rep usa para GRAVAR -- e a direcao que casa por igualdade e preserva
    -- o indice (right(identificador, 11) descartaria).
    SELECT array_remove(ARRAY[
               CASE WHEN COALESCE(s.cpf, '') <> ''
                    THEN lpad(regexp_replace(s.cpf, '\\D', '', 'g'), 12, '0') END,
               CASE WHEN COALESCE(s.pis_pasep, '') <> ''
                    THEN lpad(regexp_replace(s.pis_pasep, '\\D', '', 'g'), 12, '0') END
           ], NULL)
      INTO v_ids_afd
      FROM public.servidores s WHERE s.id = p_servidor_id;

    -- Cadastros irmaos (mesmo CPF, outra matricula). Mesmo motivo de estar aqui: como funcao de
    -- conjunto dentro do JOIN, o planner nao sabe quantas linhas esperar.
    SELECT array_agg(i.irmao_id) INTO v_irmaos
      FROM public.fn_cadastros_irmaos(ARRAY[p_servidor_id]) i;

    RETURN QUERY
    WITH dias AS MATERIALIZED (`)

// 3) orfas usa a variavel
sub(`    ident AS (
        SELECT array_remove(ARRAY[
                   CASE WHEN COALESCE(s.cpf, '') <> ''
                        THEN lpad(regexp_replace(s.cpf, '\\D', '', 'g'), 12, '0') END,
                   CASE WHEN COALESCE(s.pis_pasep, '') <> ''
                        THEN lpad(regexp_replace(s.pis_pasep, '\\D', '', 'g'), 12, '0') END
               ], NULL) AS ids
          FROM public.servidores s WHERE s.id = p_servidor_id
    ),
    orfas AS MATERIALIZED (`,
`    orfas AS MATERIALIZED (`)

sub(`           AND a.identificador_afd IN (SELECT unnest(ids) FROM ident)`,
`           AND a.identificador_afd = ANY (v_ids_afd)`)

// 4) irmao usa a variavel
sub(`          FROM public.fn_cadastros_irmaos(ARRAY[p_servidor_id]) i
          JOIN public.marcacoes_ponto m ON m.servidor_id = i.irmao_id
          LEFT JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
         WHERE m.ocorrido_em >= p_inicio`,
`          FROM public.marcacoes_ponto m
          JOIN public.servidores i ON i.id = m.servidor_id
          LEFT JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
         WHERE m.servidor_id = ANY (COALESCE(v_irmaos, ARRAY[]::uuid[]))
           AND m.ocorrido_em >= p_inicio`)

sub(`                   'matricula', i.irmao_matricula,`,
`                   'matricula', i.matricula,`)

fs.writeFileSync(ARQ, s)
console.log('  6 substituicoes aplicadas')

const c = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const g = (c.match(re) || []).length
  if (g !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${g}`)
  console.log(`  invariante OK: ${rot} (${g})`)
}
exigir(/= ANY \(v_ids_afd\)/g, 1, 'orfa busca por array resolvido')
exigir(/IN \(SELECT unnest/g, 0, 'nenhuma subquery escondendo valor do planner')
exigir(/v_irmaos/g, 3, 'irmaos em variavel: declaracao + atribuicao + uso')
exigir(/public\.fn_cadastros_irmaos\(/g, 1, 'a fonte dos irmaos continua sendo a funcao unica')
exigir(/AS MATERIALIZED/g, 4, 'dias, marc, irmao e orfas continuam materializadas')
exigir(/public\.fn_batidas_retidas_dia\(/g, 0, 'a chamada por dia continua fora')
