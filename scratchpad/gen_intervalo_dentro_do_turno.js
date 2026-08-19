/**
 * Gera a migration que mantem o INTERVALO PREVISTO dentro da janela do proprio turno.
 *
 * POR QUE POR SCRIPT (armadilha 1 do CLAUDE.md)
 *   Mexe em fn_confirmar_presenca, a funcao mais critica do sistema. O corpo vigente e COPIADO
 *   byte a byte e so o trecho alvo e trocado, com contagem conferida antes e depois.
 *
 * PARIDADE
 *   O mesmo trecho existe em fn_confirmar_presenca (2 sitios: cursor de hoje e cursor de ontem)
 *   e em fn_blocos_previstos_dia (1 sitio, que e copia mecanica do primeiro). Corrigir so um
 *   lado faria o terminal aceitar uma janela e a reconciliacao prever outra.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const ORIG_PRESENCA = '20260809000000_night_double_shift_anchor_and_transition_punch.sql'
const ORIG_BLOCOS = '20260819200000_batida_de_transicao_entre_turnos.sql'
const DESTINO = '20260819220000_intervalo_previsto_dentro_do_turno.sql'
const L = a => a.join('\r\n')
const conta = (txt, agulha) => txt.split(agulha).length - 1

const DECL = L([
  '            v_int_ini_min INTEGER;',
  '            v_int_fim_min INTEGER;',
])
const DECL_NOVA = L([
  '            v_int_ini_min INTEGER;',
  '            v_int_fim_min INTEGER;',
  '            v_int_dur INTEGER;',
])

const FIM_INTERVALO = L([
  '                v_int_fim_min := CASE',
  '                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN',
  '                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer',
  '                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN',
  '                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer',
  '                    ELSE',
  '                        v_int_ini_min + COALESCE(r.intervalo_minutos, 60)',
  '                END;',
  '            END IF;',
])

const FIM_INTERVALO_NOVO = L([
  '                v_int_fim_min := CASE',
  '                    WHEN r.intervalo_fim_personalizado IS NOT NULL THEN',
  '                        extract(hour from r.intervalo_fim_personalizado)::integer * 60 + extract(minute from r.intervalo_fim_personalizado)::integer',
  '                    WHEN r.intervalo_fim_padrao IS NOT NULL THEN',
  '                        extract(hour from r.intervalo_fim_padrao)::integer * 60 + extract(minute from r.intervalo_fim_padrao)::integer',
  '                    ELSE',
  '                        v_int_ini_min + COALESCE(r.intervalo_minutos, 60)',
  '                END;',
  '',
  '                -- O intervalo previsto tem que cair DENTRO do turno. jornadas.intervalo_*_padrao',
  '                -- e HORA ABSOLUTA (12:00), entao num plantao 19:00 -> 07:00 ele nascia antes da',
  '                -- propria entrada. Medido em 9 blocos de agosto/2026, todos plantao noturno; e o',
  '                -- que deixava a linha do plantao com intervalo as 13:02 e entrada as 19:03.',
  '                -- Ver 20260819220000.',
  '                --',
  '                -- 1. Turno que cruza a meia-noite: a hora absoluta do padrao pode pertencer ao',
  '                --    dia seguinte. 22:00 num turno 19:00 -> 07:00 ja esta certo; 01:00 e 01:00',
  '                --    do dia seguinte, e so somar um dia resolve.',
  '                IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN',
  '                    v_int_ini_min := v_int_ini_min + 1440;',
  '                    v_int_fim_min := v_int_fim_min + 1440;',
  '                END IF;',
  '',
  '                -- 2. Ainda fora do turno: o padrao da jornada nao serve para ESTE turno. Cai',
  '                --    para o relativo (o mesmo fallback de quem nao tem padrao), preservando a',
  '                --    DURACAO que o padrao definia — 12:00-14:00 continua valendo 2h.',
  '                IF v_int_ini_min < v_start_min OR v_int_fim_min > v_end_min THEN',
  '                    v_int_dur     := GREATEST(COALESCE(v_int_fim_min - v_int_ini_min, 0),',
  '                                              COALESCE(r.intervalo_minutos, 60));',
  '                    v_int_ini_min := v_start_min + 240;',
  '                    v_int_fim_min := v_int_ini_min + v_int_dur;',
  '',
  '                    -- Nao cabe nem com o relativo (turno curto): centraliza no turno.',
  '                    IF v_int_fim_min > v_end_min THEN',
  '                        v_int_ini_min := v_start_min + GREATEST(((v_end_min - v_start_min) - v_int_dur) / 2, 0);',
  '                        v_int_fim_min := v_int_ini_min + v_int_dur;',
  '                    END IF;',
  '                END IF;',
  '            END IF;',
])

const corrige = (corpo, sitios, rotulo) => {
  const nDecl = conta(corpo, DECL)
  const nFim = conta(corpo, FIM_INTERVALO)
  if (nDecl !== sitios) { console.error(`ABORTADO (${rotulo}): esperava ${sitios} declaracoes de v_int_fim_min, achei ${nDecl}.`); process.exit(1) }
  if (nFim !== sitios) { console.error(`ABORTADO (${rotulo}): esperava ${sitios} blocos de intervalo, achei ${nFim}.`); process.exit(1) }
  let out = corpo.split(DECL).join(DECL_NOVA)
  out = out.split(FIM_INTERVALO).join(FIM_INTERVALO_NOVO)
  if (conta(out, 'v_int_dur INTEGER;') !== sitios) { console.error(`ABORTADO (${rotulo}): declaracao nova nao bateu.`); process.exit(1) }
  // O fallback do CASE original e a expressao `v_start_min + 240` sem atribuicao; a atribuicao
  // explicita so existe no trecho novo, uma por sitio.
  if (conta(out, 'v_int_ini_min := v_start_min + 240;') !== sitios) {
    console.error(`ABORTADO (${rotulo}): esperava ${sitios} usos do fallback relativo novo, achei ${conta(out, 'v_int_ini_min := v_start_min + 240;')}.`)
    process.exit(1)
  }
  if (conta(out, 'v_start_min + 240') !== sitios * 2) {
    console.error(`ABORTADO (${rotulo}): o fallback do CASE original sumiu (esperava ${sitios * 2} ocorrencias de "v_start_min + 240").`)
    process.exit(1)
  }
  return out
}

// ---- 1. fn_confirmar_presenca (2 sitios: cursor de hoje e cursor de ontem) --------
const brutoP = fs.readFileSync(path.join(DIR, ORIG_PRESENCA), 'utf8')
const iA = brutoP.indexOf('CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(')
const iB = brutoP.indexOf('CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(')
if (iA < 0 || iB < 0 || iB <= iA) { console.error('ABORTADO: nao consegui recortar fn_confirmar_presenca.'); process.exit(1) }
let presenca = brutoP.slice(iA, iB)

const guardsPresenca = {
  "<> 'Sobreaviso'": 14,                      // guards de fusao de bloco (20260807000000), medidos
  'fn_jornada_tem_intervalo': 2,              // guard de intervalo (CLT Art. 71)
  'fn_ajuste_intervalo_flexivel': 3,          // intervalo flexivel (20260807050000)
  'dobra_diurna': 31,                         // guards do plantao diurno (20260809000000)
  'LANGUAGE plpgsql': 1,
}
for (const [agulha, n] of Object.entries(guardsPresenca)) {
  const achou = conta(presenca, agulha)
  if (achou !== n) { console.error(`ABORTADO (presenca/antes): esperava ${n}x "${agulha}", achei ${achou}.`); process.exit(1) }
}
presenca = corrige(presenca, 2, 'fn_confirmar_presenca')
for (const [agulha, n] of Object.entries(guardsPresenca)) {
  const achou = conta(presenca, agulha)
  if (achou !== n) { console.error(`ABORTADO (presenca/depois): esperava ${n}x "${agulha}", achei ${achou}.`); process.exit(1) }
}

// ---- 2. fn_blocos_previstos_dia (1 sitio) ----------------------------------------
const brutoB = fs.readFileSync(path.join(DIR, ORIG_BLOCOS), 'utf8')
const jA = brutoB.indexOf('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(')
const jFim = brutoB.indexOf('$fnbloco$;', jA)
if (jA < 0 || jFim < 0) { console.error('ABORTADO: nao consegui recortar fn_blocos_previstos_dia.'); process.exit(1) }
let blocos = brutoB.slice(jA, jFim + '$fnbloco$;'.length)

const guardsBlocos = {
  'auth.uid() IS NOT NULL AND NOT EXISTS': 1,  // guard de escopo (20260812130000)
  "v_s3_cat <> 'Sobreaviso'": 2,
  'turnos_inicio             := ARRAY(': 3,    // batida de transicao (20260819200000)
  'fn_jornada_tem_intervalo': 1,
  '$fnbloco$': 2,
}
for (const [agulha, n] of Object.entries(guardsBlocos)) {
  const achou = conta(blocos, agulha)
  if (achou !== n) { console.error(`ABORTADO (blocos/antes): esperava ${n}x "${agulha}", achei ${achou}.`); process.exit(1) }
}
blocos = corrige(blocos, 1, 'fn_blocos_previstos_dia')
for (const [agulha, n] of Object.entries(guardsBlocos)) {
  const achou = conta(blocos, agulha)
  if (achou !== n) { console.error(`ABORTADO (blocos/depois): esperava ${n}x "${agulha}", achei ${achou}.`); process.exit(1) }
}

// ---- 3. Montar a migration -------------------------------------------------------
const cabecalho = [
  '-- ============================================================================',
  '-- Migration: o intervalo previsto passa a cair dentro da janela do proprio turno',
  '-- Data: 2026-08-19',
  '--',
  '-- PROBLEMA (medido em producao em 19/08/2026, agosto/2026)',
  '--   jornadas.intervalo_inicio_padrao / intervalo_fim_padrao sao HORA ABSOLUTA (12:00 / 14:00).',
  '--   A montagem do turno usa esse padrao para qualquer categoria — inclusive um Plantao que',
  '--   comeca as 19:00 e termina as 07:00 do dia seguinte. Resultado: a janela de intervalo do',
  '--   plantao noturno nascia ANTES da propria entrada.',
  '--',
  '--   9 dos 3.626 blocos de agosto/2026 estao assim, todos plantao 19:00 -> 07:00 com intervalo',
  '--   previsto as 12:00. Efeito real (ICARO HENRIQUE, 18/08/2026, ja gravado ANTES de qualquer',
  '--   mudanca desta rodada — nao e regressao):',
  '--',
  '--     linha do Plantao: entrada 19:03 | intervalo 13:02 / 13:37 | saida 06:55',
  '--',
  '--   ou seja, intervalo seis horas antes da entrada. O fallback relativo que ja existia',
  '--   (v_start_min + 240) daria a resposta certa, mas so era usado quando a jornada NAO tinha',
  '--   padrao nenhum.',
  '--',
  '-- CORRECAO — duas etapas, nesta ordem',
  '--   1. Turno que cruza a meia-noite: se a hora absoluta do padrao esta antes do inicio do',
  '--      turno mas cabe somando um dia, ela pertence ao dia seguinte. 01:00 num turno',
  '--      19:00 -> 07:00 e 01:00 da madrugada, e passa a ser tratado assim.',
  '--   2. Ainda fora do turno: o padrao nao serve para este turno. Cai para o relativo,',
  '--      PRESERVANDO a duracao que o padrao definia (12:00-14:00 continua valendo 2h). Se nem',
  '--      assim couber (turno curto), centraliza no turno.',
  '--',
  '--   Turno cujo intervalo padrao ja cai dentro da janela — 3.617 dos 3.626 blocos — nao muda',
  '--   em nada: as duas condicoes sao falsas e o codigo passa direto.',
  '--',
  '-- PARIDADE (armadilha 1 do CLAUDE.md)',
  '--   O mesmo trecho existe em fn_confirmar_presenca (2 sitios: cursor de hoje e cursor de',
  '--   ontem) e em fn_blocos_previstos_dia (1 sitio, copia mecanica do primeiro). As duas sao',
  '--   corrigidas aqui: se so a copia mudasse, o terminal aceitaria uma janela de intervalo e a',
  '--   reconciliacao preveria outra.',
  '--',
  '-- NAO CORRIGE O DADO JA GRAVADO. As linhas so se ajustam rodando a reconciliacao depois',
  '--   desta migration (scratchpad/portao_dono_piso.js).',
  '--',
  '-- Corpos copiados mecanicamente de ' + ORIG_PRESENCA + ' (presenca)',
  '-- e ' + ORIG_BLOCOS + ' (blocos),',
  '-- por scratchpad/gen_intervalo_dentro_do_turno.js, que aborta se a contagem divergir.',
  '-- ============================================================================',
  '',
  '',
]

const rodapeBlocos = L([
  '',
  '',
  'COMMENT ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) IS',
  "    'Blocos de trabalho previstos de um servidor num dia, com janela de intervalo (sempre '",
  "    'dentro do turno) e o previsto de cada turno fundido (turnos_inicio/turnos_fim), que e onde '",
  "    'mora a batida de transicao. Corpo copiado mecanicamente de fn_confirmar_presenca - regerar '",
  "    'pelo script, nunca editar a mao. Sobreaviso fica de fora por construcao.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_blocos_previstos_dia(uuid, date) TO authenticated, service_role;',
  '',
])

const saida = cabecalho.join('\r\n') + presenca + blocos + rodapeBlocos

const estrutura = {
  'CREATE OR REPLACE FUNCTION': 2,
  '$fnbloco$': 2,
  'v_int_dur INTEGER;': 3,
  'IF v_int_ini_min < v_start_min AND (v_int_ini_min + 1440) <= v_end_min THEN': 3,
}
for (const [agulha, n] of Object.entries(estrutura)) {
  const achou = conta(saida, agulha)
  if (achou !== n) { console.error(`ABORTADO (arquivo): esperava ${n}x "${agulha}", achei ${achou}.`); process.exit(1) }
}
if (/\n(?!\r)/.test(saida.replace(/\r\n/g, ''))) { console.error('ABORTADO: sobrou quebra de linha sem CR (o projeto usa CRLF).'); process.exit(1) }

fs.writeFileSync(path.join(DIR, DESTINO), saida)
console.log('OK: ' + DESTINO + ' (' + saida.split('\r\n').length + ' linhas; 3 sitios corrigidos em 2 funcoes)')
