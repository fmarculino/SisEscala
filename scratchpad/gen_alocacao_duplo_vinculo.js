// Gera 20260909130000_alocacao_considera_vinculos_irmaos.sql a partir da versao VIGENTE de
// fn_alocar_marcacoes_dia (20260908150000), por copia mecanica com contagem — armadilha 1.
//
// O QUE MUDA (4 substituicoes):
//   1. DECLARE ganha v_pessoa_ids / v_sombra_serv / v_som_serv
//   2. v_pessoa_ids e resolvido no inicio (irmaos de mesmo CPF, Ativos, nao mesclados)
//   3. as candidatas passam a incluir a batida de RELOGIO dos irmaos
//   4. os passos previstos dos irmaos no MESMO dia viram SOMBRA (regra do dono entre vinculos),
//      com desempate por servidor_id quando o instante previsto empata
//
// Aborta se qualquer contagem divergir.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260908150000_alocacao_nao_atravessa_unidade.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260909130000_alocacao_considera_vinculos_irmaos.sql')

const src = fs.readFileSync(FONTE, 'utf8')
const CRLF = src.includes('\r\n')
let s = src.replace(/\r\n/g, '\n')

function troca(de, para, esperado) {
  const n = s.split(de).length - 1
  if (n !== esperado) {
    console.error(`ABORTADO: esperava ${esperado} ocorrencia(s) de:\n---\n${de.slice(0, 220)}\n---\nachou ${n}`)
    process.exit(1)
  }
  s = s.split(de).join(para)
}

// Recorta so o bloco da funcao alvo (o arquivo fonte tem tambem a conferencia da migration
// anterior, que NAO deve vir junto).
const ini = s.indexOf('CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia(')
if (ini < 0) { console.error('ABORTADO: fn_alocar_marcacoes_dia nao encontrada na fonte'); process.exit(1) }
const fimTag = '\n$fnaloc$;'
const fim = s.indexOf(fimTag, ini)
if (fim < 0) { console.error('ABORTADO: fim da funcao ($fnaloc$;) nao encontrado'); process.exit(1) }
s = s.slice(ini, fim + fimTag.length)

// ---------------------------------------------------------------------------
// 1. DECLARE
// ---------------------------------------------------------------------------
troca(
`    -- Passos previstos dos blocos dos dias VIZINHOS que nao entram nos slots deste dia.
    -- Nunca recebem alocacao: existem so para decidir de quem e a batida.
    v_sombra_prev   timestamptz[] := '{}';`,
`    -- Passos previstos dos blocos dos dias VIZINHOS que nao entram nos slots deste dia.
    -- Nunca recebem alocacao: existem so para decidir de quem e a batida.
    v_sombra_prev   timestamptz[] := '{}';
    -- De QUEM e cada sombra. NULL = dia vizinho do proprio servidor; preenchido = vinculo
    -- IRMAO (mesma pessoa, outra matricula). So serve para desempatar instante identico:
    -- sem isso, dois vinculos com o mesmo passo previsto ficariam AMBOS com a batida.
    v_sombra_serv   uuid[]        := '{}';
    v_som_serv      uuid;
    -- A PESSOA, nao a matricula: os outros cadastros Ativos com o mesmo CPF. Duplo vinculo
    -- (servidores.vinculo_multiplo_confirmado) faz a mesma pessoa ter duas matriculas, e o
    -- AFD identifica a PESSOA — a Portaria 671 nao tem campo de contrato. Vazio para a
    -- esmagadora maioria: 21 CPFs em 2.498 servidores Ativos (medido em 09/09/2026).
    v_pessoa_ids    uuid[]        := '{}';`,
  1)

// ---------------------------------------------------------------------------
// 2. Resolver os irmaos logo no inicio do corpo
// ---------------------------------------------------------------------------
troca(
`BEGIN
    -- Se o servidor possui ignora_janela_presenca = true (ex: diretores, chefias sem horário fixo),`,
`BEGIN
    -- OS OUTROS CADASTROS DA MESMA PESSOA
    --
    -- Por que isto existe: o relogio nao consegue — e por norma nao pode — distinguir dois
    -- vinculos da mesma pessoa. O registro tipo 3 do AFD carrega
    -- "NSR + data/hora + identificador(12) + CRC", e a Portaria 671 define esse identificador
    -- como o CPF/PIS do TRABALHADOR. Nao existe campo de contrato, em nenhum REP-C certificado.
    -- O equipamento, por cima disso, RECUSA o segundo cadastro ("PIS ja cadastrado" /
    -- "CPF ja cadastrado" — 1.531 falhas medidas em rep_cadastros_fila em 09/09/2026).
    --
    -- Entao a desambiguacao e do PTRP, que e o papel dele na propria Portaria: complementar e
    -- tratar, nunca alterar o dado original. Quem decide de qual matricula e a batida e o
    -- HORARIO PREVISTO — e ele resolve, porque os dois vinculos sao turnos complementares
    -- (medido: 40 dos 41 dias com as duas matriculas escaladas tem janelas DISJUNTAS,
    -- sempre MT 07-19 x N 19-07).
    --
    -- So cadastro Ativo e nao-mesclado entra: mesclado_em_servidor_id marca a duplicata ja
    -- absorvida (armadilha 50), e ressuscita-la aqui traria de volta o que a mesclagem desfez.
    SELECT COALESCE(array_agg(o.id), '{}')
      INTO v_pessoa_ids
      FROM public.servidores eu
      JOIN public.servidores o
        ON o.id <> eu.id
       AND o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND length(regexp_replace(COALESCE(o.cpf, ''), '\\D', '', 'g')) >= 11
       AND right(regexp_replace(COALESCE(o.cpf, ''), '\\D', '', 'g'), 11)
         = right(regexp_replace(COALESCE(eu.cpf, ''), '\\D', '', 'g'), 11)
     WHERE eu.id = p_servidor_id
       AND length(regexp_replace(COALESCE(eu.cpf, ''), '\\D', '', 'g')) >= 11;

    -- Se o servidor possui ignora_janela_presenca = true (ex: diretores, chefias sem horário fixo),`,
  1)

// ---------------------------------------------------------------------------
// 3. Sombras dos irmaos, no MESMO dia
// ---------------------------------------------------------------------------
troca(
`    n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);`,
`    -- 1.c SLOTS-SOMBRA DOS VINCULOS IRMAOS, no MESMO dia
    -- A regra do dono de 20260819180000 resolve "de qual DIA e esta batida". A mesma mecanica,
    -- sem uma linha nova de algoritmo, resolve "de qual VINCULO e esta batida": os passos do
    -- irmao entram como sombra e so desqualificam candidata.
    --
    -- Bloco EXCEPTION PROPRIO, e nao o de cima: o guard de escopo de fn_blocos_previstos_dia
    -- levanta insufficient_privilege quando quem chama nao alcanca o irmao, e reaproveitar o
    -- EXCEPTION anterior zeraria tambem as sombras dos dias vizinhos, que ja estao montadas.
    IF array_length(v_pessoa_ids, 1) > 0 THEN
        BEGIN
            FOR r IN
                SELECT irmao.id AS servidor_id, b.*
                  FROM unnest(v_pessoa_ids) AS irmao(id)
                  CROSS JOIN LATERAL public.fn_blocos_previstos_dia(irmao.id, p_data) b
                 ORDER BY b.inicio_previsto
            LOOP
                v_sombra_prev := v_sombra_prev || r.inicio_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;
                IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN
                    v_sombra_prev := v_sombra_prev || r.intervalo_inicio_previsto;
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                    v_sombra_prev := v_sombra_prev || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);
                    v_sombra_serv := v_sombra_serv || r.servidor_id;
                END IF;
                v_sombra_prev := v_sombra_prev || r.fim_previsto;
                v_sombra_serv := v_sombra_serv || r.servidor_id;
            END LOOP;
        EXCEPTION
            WHEN insufficient_privilege THEN
                NULL;
        END;
    END IF;

    -- v_sombra_serv acompanha v_sombra_prev posicao a posicao. As sombras de dias vizinhos
    -- foram empilhadas antes, sem dono: completa com NULL ate igualar, senao o unnest de dois
    -- arrays de tamanhos diferentes desalinha o dono da sombra.
    WHILE COALESCE(array_length(v_sombra_serv, 1), 0) < COALESCE(array_length(v_sombra_prev, 1), 0) LOOP
        v_sombra_serv := array_prepend(NULL::uuid, v_sombra_serv);
    END LOOP;

    n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);`,
  1)

// ---------------------------------------------------------------------------
// 4. Candidatas: a batida de RELOGIO do irmao tambem disputa
// ---------------------------------------------------------------------------
troca(
`                  FROM public.marcacoes_ponto m
                 WHERE m.servidor_id = p_servidor_id
                   AND m.origem = v_origem`,
`                  FROM public.marcacoes_ponto m
                 WHERE (
                           m.servidor_id = p_servidor_id
                        OR (
                           -- Batida de um vinculo IRMAO. So a de RELOGIO entra, e o motivo e o
                           -- mesmo que ja restringe o lugar logo abaixo: em origem terminal,
                           -- marcacoes_ponto.unidade_id e a LOTACAO do servidor, nao onde ele
                           -- bateu. Sem lugar confiavel nao da para dizer que as duas matriculas
                           -- disputam a mesma batida fisica — e o problema medido e inteiramente
                           -- do REP. ajuste_coordenador/ajuste_servidor sao declaracao de alguem
                           -- sobre UMA matricula: nunca disputam.
                              m.servidor_id = ANY(v_pessoa_ids)
                          AND m.origem = 'rep'
                          AND m.dispositivo_id IS NOT NULL
                           )
                       )
                   AND m.origem = v_origem`,
  1)

// ---------------------------------------------------------------------------
// 5. Desempate da regra do dono quando o instante previsto EMPATA entre vinculos
// ---------------------------------------------------------------------------
troca(
`                    SELECT t INTO v_ts_som  FROM unnest(v_sombra_prev) AS t
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;`,
`                    SELECT u.t, u.s INTO v_ts_som, v_som_serv
                      FROM unnest(v_sombra_prev, v_sombra_serv) AS u(t, s)
                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - u.t))), u.t LIMIT 1;`,
  1)

troca(
`                        IF v_d_som < v_d_real
                           OR (v_d_som = v_d_real AND v_ts_som < v_ts_real) THEN
                            CONTINUE;
                        END IF;`,
`                        IF v_d_som < v_d_real
                           OR (v_d_som = v_d_real AND v_ts_som < v_ts_real)
                           -- Instante previsto IDENTICO nos dois vinculos (so acontece com
                           -- escala sobreposta, que a trava de pessoa unica passa a impedir):
                           -- sem este ramo nenhum dos dois "perde" e a MESMA batida seria
                           -- gravada nas duas matriculas — a dupla contagem da armadilha 23,
                           -- agora dentro da mesma pessoa. Desempate por servidor_id: e
                           -- arbitrario, mas e DETERMINISTICO e simetrico, entao os dois lados
                           -- chegam a decisoes opostas e exatamente um fica com ela.
                           OR (v_d_som = v_d_real AND v_ts_som = v_ts_real
                               AND v_som_serv IS NOT NULL AND v_som_serv < p_servidor_id) THEN
                            CONTINUE;
                        END IF;`,
  1)

// ---------------------------------------------------------------------------
// Conferencia estrutural do que foi gerado
// ---------------------------------------------------------------------------
const invariantes = [
  ['dollar-quote fechado', (t) => (t.split('$fnaloc$').length - 1) === 2],
  ['um unico CREATE OR REPLACE', (t) => (t.split('CREATE OR REPLACE FUNCTION').length - 1) === 1],
  ['piso de meia-noite preservado', (t) => t.includes('v_slot_piso')],
  ['restricao de unidade preservada', (t) => t.includes('v_slot_unidade') && t.includes('outra_unidade')],
  ['reordenacao ainda inclui a unidade', (t) => t.includes('array_agg(t.uni   ORDER BY t.prev, t.ord)')],
  ['regra do dono preservada', (t) => t.includes('REGRA DO DONO')],
  ['irmao so entra por relogio', (t) => t.includes("m.origem = 'rep'\n                          AND m.dispositivo_id IS NOT NULL")],
  ['sombra do irmao alinhada', (t) => t.includes('unnest(v_sombra_prev, v_sombra_serv)')],
  ['desempate por servidor_id', (t) => t.includes('v_som_serv < p_servidor_id')],
  ['mesclado nao volta', (t) => t.includes('o.mesclado_em_servidor_id IS NULL')],
]
let falhou = false
for (const [nome, teste] of invariantes) {
  const ok = teste(s)
  if (!ok) falhou = true
  console.log(`${ok ? '  ok  ' : ' FALHA'}  ${nome}`)
}
if (falhou) { console.error('\nABORTADO: invariante estrutural quebrado.'); process.exit(1) }

const cabecalho = fs.readFileSync(path.join(__dirname, 'cab_duplo_vinculo.txt'), 'utf8').replace(/\r\n/g, '\n')
const rodape = fs.readFileSync(path.join(__dirname, 'rod_duplo_vinculo.txt'), 'utf8').replace(/\r\n/g, '\n')
let saida = cabecalho + '\n' + s + '\n' + rodape
if (CRLF) saida = saida.replace(/\n/g, '\r\n')
fs.writeFileSync(DESTINO, saida)
console.log(`\ngerado: ${path.relative(RAIZ, DESTINO)}  (${saida.split(/\r?\n/).length} linhas)`)
