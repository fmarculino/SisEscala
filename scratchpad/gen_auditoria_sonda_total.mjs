// Materializa a ultima CTE que faltava (`escala`) e troca a sonda de UM suspeito por uma sonda
// que mede TODAS as etapas. ABORTA se algum trecho nao bater exatamente 1x.
//
// 🚨 Cinco rodadas em producao, e as partes isoladas medidas somam ~10 ms:
//     orfa 1 ms · batidas 3 ms · irmao 5 ms · funcao inteira 5.243 ms
// Perseguir um suspeito por vez ja custou quatro tentativas. A partir daqui a sonda mede TUDO de
// uma vez: qualquer que seja a etapa cara, ela aparece na primeira mensagem.
//
// `escala` e a unica CTE grande que nunca foi materializada, e e' a suspeita restante: ela junta
// escala_mensal com escala_diaria por `make_date(...) BETWEEN`, que nao e indexavel -- e mudar a
// seletividade do BETWEEN de 1 para 8 dias e' exatamente o que faz um planner inverter o plano.
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

// 1) a CTE que faltava
sub(`    escala AS (
        SELECT make_date(em.ano, em.mes, ed.dia) AS data,`,
`    -- MATERIALIZED como as demais: sem isso o planner pode empurrar este par de tabelas para
    -- dentro do LEFT JOIN com \`dias\` e reavalia-lo por dia. \`make_date(...)\` nao e indexavel,
    -- entao a escolha de plano depende da seletividade do BETWEEN -- que muda com o periodo.
    escala AS MATERIALIZED (
        SELECT make_date(em.ano, em.mes, ed.dia) AS data,`)

// 2) a sonda passa a medir TODAS as etapas
sub(`            -- Mede a CTE do IRMAO isolada (30 dias). Orfa (1 ms) e batidas (3 ms) ja foram
            -- rep_afd_registros (3,17 milhoes de linhas) e a unica suspeita de perder o indice.
            -- Rapida aqui e lenta na funcao = o problema esta noutra CTE; lenta aqui = e o plano.
            SELECT array_remove(ARRAY[
                       CASE WHEN COALESCE(sx.cpf, '') <> '' THEN lpad(regexp_replace(sx.cpf, 'D', '', 'g'), 12, '0') END,
                       CASE WHEN COALESCE(sx.pis_pasep, '') <> '' THEN lpad(regexp_replace(sx.pis_pasep, 'D', '', 'g'), 12, '0') END
                   ], NULL) INTO v_ids FROM public.servidores sx WHERE sx.id = v_srv;
            v_ini := clock_timestamp();
            SELECT array_agg(i.irmao_id) INTO v_irm FROM public.fn_cadastros_irmaos(ARRAY[v_srv]) i;
            PERFORM m.id FROM public.marcacoes_ponto m
              WHERE v_irm IS NOT NULL
                AND m.servidor_id = ANY (v_irm)
                AND m.ocorrido_em >= (now() - interval '29 days')::date
                AND m.ocorrido_em <  (now()::date + 1);
            v_msOrfa := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            RAISE EXCEPTION 'fn_auditoria_ponto_servidor lenta demais: 1 dia = % ms, 8 dias = % ms, '
                            '30 dias = % ms. Nao cabe no timeout de authenticated (8s) num periodo '
                            'de 62 dias. (CTE do irmao isolada, 30 dias: % ms)',
                            round(v_ms1), round(v_ms), round(v_ms30), round(v_msOrfa);`,
`            -- 🚨 Mede TODAS as etapas, nao um suspeito. Quatro rodadas foram gastas eliminando
            -- um candidato por vez (orfa 1 ms, batidas 3 ms, irmao 5 ms) enquanto a funcao inteira
            -- levava 5 s -- ou seja, a soma das partes nunca explicou o todo. Com todos os tempos
            -- na mesma mensagem, a etapa cara aparece de primeira, seja ela qual for.
            v_ini := clock_timestamp();
            PERFORM em.unidade_id
               FROM public.escala_mensal em
               JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
              WHERE em.servidor_id = v_srv
                AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_ini30 AND v_hoje;
            v_msGuard := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            PERFORM make_date(em.ano, em.mes, ed.dia), dt.codigo, u.nome, ds.nome
               FROM public.escala_mensal em
               JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
               LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
               LEFT JOIN public.unidades u ON u.id = em.unidade_id
               LEFT JOIN public.setores st ON st.id = em.setor_id
               LEFT JOIN public.dicionario_setores ds ON ds.id = st.dicionario_setor_id
              WHERE em.servidor_id = v_srv
                AND ed.categoria <> 'Sobreaviso'
                AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_ini30 AND v_hoje;
            v_msEscala := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            PERFORM m.id,
                    public.fn_batida_fisica(m.origem, m.sintetica),
                    public.fn_marcacao_desconsiderada(m.id),
                    (SELECT a.nsr FROM public.rep_afd_registros a WHERE a.id = m.afd_registro_id)
               FROM public.marcacoes_ponto m
              WHERE m.servidor_id = v_srv
                AND m.ocorrido_em >= v_ini30
                AND m.ocorrido_em <  (v_hoje + 1);
            v_msMarc := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            v_ini := clock_timestamp();
            SELECT array_agg(i.irmao_id) INTO v_irm FROM public.fn_cadastros_irmaos(ARRAY[v_srv]) i;
            PERFORM m.id FROM public.marcacoes_ponto m
              WHERE v_irm IS NOT NULL
                AND m.servidor_id = ANY (v_irm)
                AND m.ocorrido_em >= v_ini30
                AND m.ocorrido_em <  (v_hoje + 1);
            v_msIrmao := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            SELECT array_remove(ARRAY[
                       CASE WHEN COALESCE(sx.cpf, '') <> '' THEN lpad(regexp_replace(sx.cpf, '[^0-9]', '', 'g'), 12, '0') END,
                       CASE WHEN COALESCE(sx.pis_pasep, '') <> '' THEN lpad(regexp_replace(sx.pis_pasep, '[^0-9]', '', 'g'), 12, '0') END
                   ], NULL) INTO v_ids FROM public.servidores sx WHERE sx.id = v_srv;
            v_ini := clock_timestamp();
            PERFORM count(*) FROM public.rep_afd_registros a
             WHERE a.tipo_registro = '3'
               AND a.identificador_afd = ANY (v_ids)
               AND a.ocorrido_em >= v_ini30
               AND a.ocorrido_em <  (v_hoje + 1)
               AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id);
            v_msOrfa := EXTRACT(EPOCH FROM (clock_timestamp() - v_ini)) * 1000;

            RAISE EXCEPTION 'fn_auditoria_ponto_servidor lenta demais: 1 dia = % ms, 8 dias = % ms, '
                            '30 dias = % ms (teto: 8s de authenticated). ETAPAS em 30 dias -- '
                            'guard=% ms, escala=% ms, batidas=% ms, irmao=% ms, orfas=% ms.',
                            round(v_ms1), round(v_ms), round(v_ms30),
                            round(v_msGuard), round(v_msEscala), round(v_msMarc),
                            round(v_msIrmao), round(v_msOrfa);`)

// 3) variaveis novas
sub(`    v_irm    uuid[];`,
`    v_irm      uuid[];
    v_msGuard  numeric;
    v_msEscala numeric;
    v_msMarc   numeric;
    v_msIrmao  numeric;
    v_ini30    date;
    v_hoje     date;`)

sub(`    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' ORDER BY created_at LIMIT 1;`,
`    v_hoje  := now()::date;
    v_ini30 := (now() - interval '29 days')::date;
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' ORDER BY created_at LIMIT 1;`)

fs.writeFileSync(ARQ, s)
console.log('  4 substituicoes aplicadas')

const c = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const g = (c.match(re) || []).length
  if (g !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${g}`)
  console.log(`  invariante OK: ${rot} (${g})`)
}
exigir(/AS MATERIALIZED/g, 6, 'dias, escala, marc_base, marc, irmao e orfas materializadas')
exigir(/v_msGuard|v_msEscala|v_msMarc|v_msIrmao/g, 8, 'sonda mede as 4 etapas (2 usos cada)')
// 🚨 O regexp da sonda antiga estava com 'D' em vez de '[^0-9]': a barra sumiu ao passar pelo
// gerador anterior, e a sonda media outra coisa. Aqui e classe de caractere explicita.
exigir(/regexp_replace\(sx\.cpf, '\[\^0-9\]'/g, 1, 'sonda usa classe explicita, nao \\D que se perde no escape')
