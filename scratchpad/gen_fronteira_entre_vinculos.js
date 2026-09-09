// Gera 20260909160000_fronteira_entre_vinculos.sql a partir de 20260909130000 (a VIGENTE de
// fn_alocar_marcacoes_dia). Copia mecanica com contagem — armadilha 1.
//
// O QUE MUDA: na fronteira entre DOIS VINCULOS da mesma pessoa (a saida de um turno e a entrada
// do outro previstas para o MESMO instante), a regra do dono deixa de desqualificar a candidata.
// Fora dessa combinacao exata, nada muda.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260909130000_alocacao_considera_vinculos_irmaos.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260909160000_fronteira_entre_vinculos.sql')

const src = fs.readFileSync(FONTE, 'utf8')
const CRLF = src.includes('\r\n')
let s = src.replace(/\r\n/g, '\n')

const ini = s.indexOf('CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(')
const fimTag = '\n$fnaloc$;'
const fim = s.indexOf(fimTag, ini)
if (ini < 0 || fim < 0) { console.error('ABORTADO: funcao nao delimitada na fonte'); process.exit(1) }
s = s.slice(ini, fim + fimTag.length)

function troca(de, para, esperado) {
  const n = s.split(de).length - 1
  if (n !== esperado) {
    console.error(`ABORTADO: esperava ${esperado} de:\n---\n${de.slice(0, 200)}\n---\nachou ${n}`)
    process.exit(1)
  }
  s = s.split(de).join(para)
}

// 1. DECLARE: o PASSO de cada sombra
troca(
`    v_sombra_serv   uuid[]        := '{}';
    v_som_serv      uuid;`,
`    v_sombra_serv   uuid[]        := '{}';
    v_som_serv      uuid;
    -- Qual PASSO cada sombra representa. So e usado para reconhecer a FRONTEIRA entre dois
    -- vinculos: saida de um turno e entrada do outro previstas para o mesmo instante.
    v_sombra_passo  text[]        := '{}';
    v_som_passo     text;
    v_real_passo    text;`,
  1)

// 2. As sombras dos irmaos passam a empilhar o passo junto
troca(
`                v_sombra_prev := v_sombra_prev || r.inicio_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;
                IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                    v_sombra_prev := v_sombra_prev || r.intervalo_inicio_previsto;
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                    v_sombra_prev := v_sombra_prev || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                END IF;
                v_sombra_prev := v_sombra_prev || r.fim_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;`,
`                v_sombra_prev  := v_sombra_prev  || r.inicio_previsto;
                v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                v_sombra_passo := v_sombra_passo || 'entrada'::text;
                IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                    v_sombra_prev  := v_sombra_prev  || r.intervalo_inicio_previsto;
                    v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                    v_sombra_passo := v_sombra_passo || 'intervalo_saida'::text;
                    v_sombra_prev  := v_sombra_prev  || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
                    v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                    v_sombra_passo := v_sombra_passo || 'intervalo_retorno'::text;
                END IF;
                v_sombra_prev  := v_sombra_prev  || r.fim_previsto;
                v_sombra_serv  := v_sombra_serv  || r.servidor_id;
                v_sombra_passo := v_sombra_passo || 'saida'::text;`,
  1)

// 3. O completar com NULL vale para os tres arrays
troca(
`    WHILE COALESCE(array_length(v_sombra_serv, 1), 0) < COALESCE(array_length(v_sombra_prev, 1), 0) LOOP
        v_sombra_serv := array_prepend(NULL::uuid, v_sombra_serv);
    END LOOP;`,
`    WHILE COALESCE(array_length(v_sombra_serv, 1), 0) < COALESCE(array_length(v_sombra_prev, 1), 0) LOOP
        v_sombra_serv  := array_prepend(NULL::uuid, v_sombra_serv);
        v_sombra_passo := array_prepend(NULL::text, v_sombra_passo);
    END LOOP;`,
  1)

// 4. Capturar o passo dos dois lados no desempate
troca(
`                    SELECT t INTO v_ts_real FROM unnest(v_slot_prev) AS t
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;`,
`                    SELECT u.t, u.p INTO v_ts_real, v_real_passo
                      FROM unnest(v_slot_prev, v_slot_passo) AS u(t, p)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;`,
  1)

troca(
`                    SELECT u.t, u.s INTO v_ts_som, v_som_serv
                      FROM unnest(v_sombra_prev, v_sombra_serv) AS u(t, s)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;`,
`                    SELECT u.t, u.s, u.p INTO v_ts_som, v_som_serv, v_som_passo
                      FROM unnest(v_sombra_prev, v_sombra_serv, v_sombra_passo) AS u(t, s, p)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;`,
  1)

// 5. A fronteira entre vinculos nao desqualifica
troca(
`                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN`,
`                    -- FRONTEIRA ENTRE VINCULOS: a saida de um turno e a entrada do outro
                    -- previstas para o MESMO instante. Uma batida fisica ali fecha um turno e
                    -- abre o seguinte — e' o comportamento que o sistema JA trata como desejado
                    -- entre blocos encostados do mesmo servidor (armadilha 6, e os slots de
                    -- fronteira de 20260819200000). A regra do dono nao pode desqualificar aqui:
                    -- ela existe para impedir que a mesma batida sirva ao MESMO passo em dois
                    -- lugares, nao para impedir que o fim de um turno encoste no inicio do outro.
                    --
                    -- MEDIDO em 09/09/2026 (ELAYNE, mat 54464 e 68140, 02/09): MT 07:00-19:00 numa
                    -- matricula e N 19:00-07:00 na outra, com DUAS batidas na fronteira (19:00 e
                    -- 19:05). A 54464 ficava com a 19:00 como entrada e a 68140 ficava SEM SAIDA —
                    -- e a batida das 19:05 nao era usada por ninguem, porque a regra do dono a
                    -- desqualificava dos dois lados. Quatro dias assim so' nessa pessoa.
                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL
                       AND v_som_serv IS NOT NULL
                       AND v_ts_som = v_ts_real
                       AND v_real_passo IS DISTINCT FROM v_som_passo
                       AND v_real_passo IN ('entrada', 'saida')
                       AND v_som_passo  IN ('entrada', 'saida') THEN
                        NULL;   -- fronteira: a candidata continua disputando deste lado
                    ELSIF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN`,
  1)

const invariantes = [
  ['dollar-quote fechado', (t) => (t.split('$fnaloc$').length - 1) === 2],
  ['um unico CREATE OR REPLACE', (t) => (t.split('CREATE OR REPLACE FUNCTION').length - 1) === 1],
  ['vinculos irmaos preservados', (t) => t.includes('v_pessoa_ids')],
  ['desempate por servidor_id preservado', (t) => t.includes('v_som_serv < p_servidor_id')],
  ['restricao de unidade preservada', (t) => t.includes('outra_unidade')],
  ['piso de meia-noite preservado', (t) => t.includes('v_slot_piso')],
  ['sombra carrega o passo', (t) => t.includes('unnest(v_sombra_prev, v_sombra_serv, v_sombra_passo)')],
  ['os tres arrays de sombra sao completados juntos', (t) => t.includes("array_prepend(NULL::text, v_sombra_passo)")],
  ['a fronteira exige passos DIFERENTES', (t) => t.includes('v_real_passo IS DISTINCT FROM v_som_passo')],
  ['a fronteira so vale entre entrada e saida', (t) => (t.match(/IN \('entrada', 'saida'\)/g) || []).length === 2],
  ['a fronteira so vale para sombra de IRMAO', (t) => t.includes("AND v_som_serv IS NOT NULL\n                       AND v_ts_som = v_ts_real")],
]
let falhou = false
for (const [nome, teste] of invariantes) {
  const ok = teste(s); if (!ok) falhou = true
  console.log(`${ok ? '  ok  ' : ' FALHA'}  ${nome}`)
}
if (falhou) { console.error('\nABORTADO: invariante estrutural quebrado.'); process.exit(1) }

const cab = fs.readFileSync(path.join(__dirname, 'cab_fronteira_vinculos.txt'), 'utf8').replace(/\r\n/g, '\n')
const rod = fs.readFileSync(path.join(__dirname, 'rod_fronteira_vinculos.txt'), 'utf8').replace(/\r\n/g, '\n')
let saida = cab + '\n' + s + '\n' + rod
if (CRLF) saida = saida.replace(/\n/g, '\r\n')
fs.writeFileSync(DESTINO, saida)
console.log(`\ngerado: ${path.relative(RAIZ, DESTINO)}  (${saida.split(/\r?\n/).length} linhas)`)
