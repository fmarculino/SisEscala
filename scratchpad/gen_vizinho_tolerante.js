// Gera 20260909170000: o dia VIZINHO fora do escopo nao pode derrubar a alocacao.
//
// fn_alocar_marcacoes_dia monta os slots candidatos a partir de (p_data - 1, p_data). O guard
// de escopo de fn_blocos_previstos_dia (20260812130000) exige escala_mensal do servidor NO MES
// DA DATA CONSULTADA - entao no dia 1 do mes a chamada de p_data-1 cai no mes anterior e, se o
// servidor nao tiver escala la, levanta insufficient_privilege para QUALQUER papel logado.
//
// Os blocos 1.b (sombras) e 1.c (irmaos) ja tratam essa excecao. O bloco 1 nao tratava.
// Copia mecanica da fonte vigente, com UMA substituicao. Nao redigitar corpo de funcao.
const fs = require('fs')
const path = require('path')

const RAIZ  = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260909160000_fronteira_entre_vinculos.sql')
const ALVO  = path.join(RAIZ, 'supabase/migrations/20260909170000_dia_vizinho_fora_do_escopo_nao_derruba.sql')

const src = fs.readFileSync(FONTE, 'utf8')

// A convencao do projeto e CRLF, mas nem toda migration seguiu. DETECTA em vez de assumir:
// montar o padrao com o EOL errado faz a substituicao virar no-op silencioso (armadilha 48).
const CRLF = String.fromCharCode(13) + String.fromCharCode(10)
const LF   = String.fromCharCode(10)
const EOL  = src.includes(CRLF) ? CRLF : LF
console.log('EOL da fonte: ' + (EOL === CRLF ? 'CRLF' : 'LF'))

const contar = (hay, needle) => hay.split(needle).length - 1
const exigir = (cond, msg) => { if (!cond) { console.error('ABORTADO: ' + msg); process.exit(1) } }

// --- invariantes da FONTE -------------------------------------------------
exigir(contar(src, 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia') === 1,
  'a fonte deve recriar fn_alocar_marcacoes_dia exatamente uma vez')
exigir(contar(src, 'fn_blocos_previstos_dia(') === 3,
  'a fonte deve chamar fn_blocos_previstos_dia 3x (candidatos, sombras, irmaos); achei ' + contar(src, 'fn_blocos_previstos_dia('))
exigir(contar(src, 'WHEN insufficient_privilege THEN') === 2,
  'a fonte deve ter 2 tratamentos de insufficient_privilege antes desta correcao')

const iIni = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia')
const iFim = src.indexOf('COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia')
exigir(iIni > 0 && iFim > iIni, 'nao localizei os limites da funcao na fonte')
let corpo = src.slice(iIni, iFim)

// --- a substituicao -------------------------------------------------------
// Preserva a semantica exata do WHERE original:
//   p_data     -> entra sempre (era "d.dia_ref = p_data")
//   p_data - 1 -> so os blocos que atravessam a meia-noite
// A unica diferenca e a fonte da chamada do dia vizinho, que tolera a recusa de escopo.
const DE = [
  '        SELECT d.dia_ref, b.*',
  '          FROM (VALUES (p_data - 1), (p_data)) AS d(dia_ref)',
  '          CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b',
  '         WHERE d.dia_ref = p_data',
  '            OR b.fim_previsto > v_meia_noite',
  '         ORDER BY b.inicio_previsto',
].join(EOL)

const PARA = [
  '        SELECT * FROM (',
  '            -- O DIA CONSULTADO: a recusa de escopo aqui e legitima e PRECISA propagar.',
  '            SELECT d.dia_ref, b.*',
  '              FROM (VALUES (p_data)) AS d(dia_ref)',
  '              CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b',
  '            UNION ALL',
  '            -- O DIA VIZINHO (09/09/2026): so os blocos de ontem que atravessam a meia-noite.',
  '            -- fn_blocos_previstos_dia_vizinho engole insufficient_privilege e devolve vazio.',
  '            -- Sem isso, todo dia 1 do mes de servidor sem escala no mes anterior derrubava a',
  '            -- alocacao inteira para qualquer usuario logado - service_role bypassa o guard, e',
  '            -- por isso o defeito ficou latente ate a v2.49.0 chamar a cadeia com sessao.',
  '            SELECT d.dia_ref, b.*',
  '              FROM (VALUES (p_data - 1)) AS d(dia_ref)',
  '              CROSS JOIN LATERAL public.fn_blocos_previstos_dia_vizinho(p_servidor_id, d.dia_ref) b',
  '             WHERE b.fim_previsto > v_meia_noite',
  '        ) x',
  '         ORDER BY x.inicio_previsto',
].join(EOL)

exigir(contar(corpo, DE) === 1,
  'o bloco 1 (slots candidatos) nao bate com o esperado na fonte - 1 exigida, achei ' + contar(corpo, DE))
corpo = corpo.replace(DE, () => PARA)

// --- invariantes do RESULTADO --------------------------------------------
exigir(contar(corpo, 'fn_blocos_previstos_dia(') === 3,
  'o resultado deve ter 3 chamadas diretas: dia consultado, sombras e irmaos')
exigir(contar(corpo, 'fn_blocos_previstos_dia_vizinho(') === 1,
  'o resultado deve ter 1 chamada tolerante (dia vizinho do bloco 1)')
exigir(contar(corpo, 'WHEN insufficient_privilege THEN') === 2,
  'os 2 tratamentos existentes (sombras e irmaos) precisam sobreviver')

// Defesas que nao podem sair na copia (CLAUDE.md armadilhas 6, 23, 55 e a regra do dono).
for (const marca of ['v_slot_unidade', 'v_slot_unidade[s] <> v_m_uni[k]', 'v_bloco_unidade', 'v_sombra_prev', 'v_pessoa_ids', 'fronteira']) {
  exigir(contar(corpo, marca) > 0, 'defesa ausente no resultado: ' + marca)
}
// A reordenacao dos slots por instante previsto (20260819200000) tem que incluir a unidade,
// senao a restricao de lugar passa a comparar a batida com a unidade de OUTRO passo.
exigir(contar(corpo, 'v_slot_unidade') >= 3,
  'v_slot_unidade precisa aparecer tambem na reordenacao dos slots')

const cab = fs.readFileSync(path.join(RAIZ, 'scratchpad/cab_vizinho_tolerante.txt'), 'utf8')
const rod = fs.readFileSync(path.join(RAIZ, 'scratchpad/rod_vizinho_tolerante.txt'), 'utf8')

fs.writeFileSync(ALVO, cab + corpo + rod, 'utf8')
console.log('OK -> ' + path.basename(ALVO))
console.log('  chamadas diretas ao guard : ' + contar(corpo, 'fn_blocos_previstos_dia('))
console.log('  chamada tolerante         : ' + contar(corpo, 'fn_blocos_previstos_dia_vizinho('))
console.log('  tratamentos preservados   : ' + contar(corpo, 'WHEN insufficient_privilege THEN'))
