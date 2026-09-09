// Gera a migration que tira o escopo do COORDENADOR do caminho do TERMINAL LOCAL.
//
// Copia mecanica de fn_confirmar_presenca a partir da migration VIGENTE dela
// (20260908140000). Nao redigitar corpo de funcao a mao (armadilha 1): este script aborta se
// qualquer contagem de ocorrencia divergir.
//
// split().join(), nunca String.replace com string (replace interpreta $$ e $').
const fs = require('fs')

const FONTE = 'supabase/migrations/20260908140000_bloco_nao_atravessa_unidade.sql'
const SAIDA = 'supabase/migrations/20260909100000_terminal_local_nao_herda_escopo_do_coordenador.sql'

const src = fs.readFileSync(FONTE, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'

// Extrai SO fn_confirmar_presenca. fn_blocos_previstos_dia esta no mesmo arquivo e nao muda —
// recria-la aqui so aumentaria a superficie de uma copia mecanica sem necessidade.
const INI = 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca('
const FIM = '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;'
const i = src.indexOf(INI)
const j = src.indexOf(FIM, i)
if (i < 0 || j < 0) { console.error('ABORTADO: nao achei fn_confirmar_presenca na fonte.'); process.exit(1) }
let out = src.slice(i, j + FIM.length)

if ((out.split('CREATE OR REPLACE FUNCTION').length - 1) !== 1) {
  console.error('ABORTADO: o extrato contem mais de uma funcao — o marcador de fim mudou.')
  process.exit(1)
}

// A ancora e o INICIO do fallback por escala. O bypass entra ANTES dele, e depois do
// IF/ELSE que resolve profile_unidades/profile_setores — se entrasse antes, o ELSE
// sobrescreveria v_has_unit_access com o SELECT EXISTS e o bypass nao valeria de nada.
const ANCORA = [
  '            END IF;',
  '        END IF;',
  '',
  '        IF NOT v_has_sector_access THEN',
  '            SELECT EXISTS (',
  '                SELECT 1 ',
  '                FROM public.escala_diaria ed',
].join(EOL)

const BYPASS = [
  '            END IF;',
  '        END IF;',
  '',
  '        -- TERMINAL LOCAL: quem confere o escopo e o EQUIPAMENTO, nao o coordenador.',
  '        --',
  '        -- fn_registrar_ponto_terminal_local ja recusou, uma chamada antes, toda matricula que',
  '        -- nao pertence a unidade/setor do proprio terminal (20260811180000). O guard abaixo e o',
  '        -- do terminal CLASSICO, onde o coordenador loga na maquina e a sessao dele fica aberta',
  '        -- na sala: la ele impede que alguem de outro setor use aquela sessao. No terminal local',
  '        -- nao existe sessao de coordenador — o responsavel e quem RESPONDE pelo equipamento, e',
  '        -- exigir que ele tambem tenha escopo e uma segunda regra, de outra natureza.',
  '        --',
  '        -- Medido em 08/09/2026: o terminal do CAF POLO II estava com uma coordenadora do HMI',
  '        -- como responsavel, e as batidas dos 6 lotados eram TODAS recusadas — 59 tentativas em',
  '        -- 4 dias uteis, com o coordenador validando ~20 por dia a mao. A batida nao se perdia',
  '        -- (vira marcacao pendente), mas o servidor via "recusado" na tela do terminal.',
  '        --',
  '        -- O GUC e publicado por fn_registrar_ponto_terminal_local e e LOCAL A TRANSACAO',
  '        -- (set_config com terceiro argumento true). Cada RPC via PostgREST e uma transacao',
  '        -- propria, entao nao ha como um chamador de fora publica-lo e depois entrar aqui.',
  "        IF COALESCE(current_setting('sisescala.canal_ponto', true), '') = 'terminal_local' THEN",
  '            v_has_unit_access   := true;',
  '            v_has_sector_access := true;',
  '        END IF;',
  '',
  '        IF NOT v_has_sector_access THEN',
  '            SELECT EXISTS (',
  '                SELECT 1 ',
  '                FROM public.escala_diaria ed',
].join(EOL)

const SUBS = [[ANCORA, BYPASS, 1]]

let falhou = false
for (const [de, para, esperado] of SUBS) {
  const n = out.split(de).length - 1
  const ok = n === esperado
  if (!ok) falhou = true
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${n}/${esperado}  bypass do terminal local antes do fallback por escala`)
  out = out.split(de).join(para)
}
if (falhou) { console.error('\nABORTADO: contagem divergente. Nao gerei nada.'); process.exit(1) }

// --- invariantes ---
const INV = [
  ['CREATE OR REPLACE FUNCTION', 1, 'uma funcao so'],
  ['$$', 2, 'dollar-quoting em par'],
  ["current_setting('sisescala.canal_ponto', true)", 1, 'o bypass entrou uma vez'],
  ['IF NOT v_has_sector_access THEN', 2, 'o fallback por escala e a recusa continuam'],
]
for (const [p, esperado, rot] of INV) {
  const n = out.split(p).length - 1
  if (n !== esperado) { console.error(`ABORTADO: ${rot}: "${p}" aparece ${n}x, esperado ${esperado}`); process.exit(1) }
  console.log(`ok   invariante: ${rot} (${n})`)
}

// Guards que a copia NAO pode ter perdido (armadilha 1).
const GUARDS = [
  'Sem permissão para validar este servidor nesta unidade/setor.',   // o guard continua existindo

  "v_s1_cat <> 'Sobreaviso'",
  'v_s1_unidade IS NOT DISTINCT FROM v_s2_unidade',                   // 20260908140000
  'fn_ancora_plantao_livre_do_regular',
  'fn_intervalo_previsto_minutos',
  'fn_jornada_tem_intervalo',
  'fn_ajuste_intervalo_flexivel',
  'obter_jornada_servidor_data',
  'em.unidade_id as escala_unidade_id',
]
for (const g of GUARDS) {
  const n = out.split(g).length - 1
  if (n === 0) { console.error(`ABORTADO: guard ausente no resultado: ${g}`); process.exit(1) }
  console.log(`ok   guard presente (${String(n).padStart(2)}x): ${g.slice(0, 62)}`)
}

// O bypass NAO pode alcancar o terminal classico: se alguem trocar a comparacao por algo que
// aceite qualquer canal, o guard de escopo do coordenador morre para todo mundo.
if (!out.includes("= 'terminal_local' THEN")) {
  console.error('ABORTADO: o bypass nao esta restrito ao canal terminal_local.')
  process.exit(1)
}
console.log("ok   o bypass so vale para canal_ponto = 'terminal_local'")

const cab = fs.readFileSync('scratchpad/cab_terminal_local_escopo.txt', 'utf8')
const rod = fs.readFileSync('scratchpad/rod_terminal_local_escopo.txt', 'utf8')
fs.writeFileSync(SAIDA, cab + out + EOL + rod)
console.log(`\ngerado: ${SAIDA} (${fs.statSync(SAIDA).size} bytes)`)
