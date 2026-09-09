// Gera 20260909120000_fila_rep_transitorio_nao_queima_por_contagem.sql a partir da migration
// VIGENTE de fn_confirmar_cadastro_rep (20260830130000). Copia mecanica: aborta se qualquer
// substituicao nao bater na contagem (armadilha 1). Nao redigite o corpo da funcao a mao.
const fs = require('fs')
const FONTE = 'supabase/migrations/20260830130000_fila_rep_confere_dispositivo.sql'
const SAIDA = 'supabase/migrations/20260909120000_fila_rep_transitorio_nao_queima_por_contagem.sql'

const src = fs.readFileSync(FONTE, 'utf8')
const CRLF = src.includes('\r\n')
const t = src.replace(/\r\n/g, '\n')
const conta = (h, n) => h.split(n).length - 1
const exigir = (c, m) => { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

const ini = t.indexOf('CREATE OR REPLACE FUNCTION public.fn_confirmar_cadastro_rep(')
exigir(ini >= 0, 'nao achei fn_confirmar_cadastro_rep em ' + FONTE)
const fim = t.indexOf('$fn$;', ini)
exigir(fim > ini, 'nao achei o fechamento do dollar-quote')
let fn = t.slice(ini, fim + '$fn$;'.length)

// Invariantes da fonte que NAO podem se perder na copia.
exigir(conta(fn, 'p_dispositivo_id IS NOT NULL AND v_dispositivo_id IS DISTINCT FROM p_dispositivo_id') === 1,
  'guard de dono da fila (armadilha 41) ausente na fonte')
exigir(conta(fn, "status = 'enviado'") === 1, "esperava 1x status = 'enviado'")
exigir(conta(fn, 'rep_vinculos_servidor') >= 1, 'esperava a criacao de vinculo')
exigir(conta(fn, 'SECURITY DEFINER') === 1, 'esperava SECURITY DEFINER')

// --- 1. declaracao: teto de CONTAGEM vira teto de TEMPO ---
const DECL_DE = [
  '    v_ident          text;',
  '    -- Teto de tentativas para falha transitoria. Sem teto, um relogio removido da unidade',
  '    -- deixaria itens em \'pendente\' para sempre e ninguem olharia a tela de erro.',
  '    c_max_tentativas constant integer := 5;',
].join('\n')
exigir(conta(fn, DECL_DE) === 1, 'bloco de declaracao do teto nao bateu')
const DECL_PARA = [
  '    v_ident          text;',
  '    v_criado_em      timestamptz;',
  '    -- Teto para falha transitoria. Ele existe pelo motivo certo (relogio REMOVIDO da unidade',
  '    -- nao pode deixar item em \'pendente\' para sempre, invisivel na tela de erro), mas contar',
  '    -- TENTATIVAS mede a coisa errada: com a espera crescente de 5 min, cinco tentativas sao',
  '    -- ~70 minutos. Um relogio sem energia por uma tarde, um fim de semana ou uma troca de',
  '    -- switch queimava o cadastro do mesmo jeito - e depois de \'falhou\' a pessoa ainda ficava',
  '    -- ate 30 dias fora por fn_cadastro_rep_reprovado.',
  '    --',
  '    -- Medido no HMM em 08/09/2026: o REP-iDClass-HMM-04 ficou ~2h sem responder e 301 cadastros',
  '    -- foram queimados. Com o coletor v0.17.0 corrigido (que passa a marcar isso como',
  '    -- transitorio) o teto de 5 tentativas AINDA teria queimado os mesmos 301.',
  '    --',
  '    -- O criterio certo e TEMPO NA FILA: enquanto o item e novo, insista - equipamento volta.',
  '    -- Passada uma semana sem nunca conseguir, ai sim e sinal de que aquele relogio nao volta',
  '    -- sozinho, e o caso precisa aparecer para uma pessoa.',
  '    c_max_dias_transitorio constant integer := 7;',
  '    -- Teto da espera entre tentativas: sem ele, item antigo esperaria horas entre retentativas',
  '    -- e o relogio poderia voltar sem ninguem tentar.',
  '    c_espera_maxima constant interval := interval \'60 minutes\';',
].join('\n')
fn = fn.replace(DECL_DE, () => DECL_PARA)

// --- 2. SELECT INTO precisa trazer created_at ---
const SEL_DE = [
  '    SELECT dispositivo_id, servidor_id, tentativas',
  '      INTO v_dispositivo_id, v_servidor_id, v_tentativas',
].join('\n')
exigir(conta(fn, SEL_DE) === 1, 'SELECT INTO da fila nao bateu')
fn = fn.replace(SEL_DE, () => [
  '    SELECT dispositivo_id, servidor_id, tentativas, created_at',
  '      INTO v_dispositivo_id, v_servidor_id, v_tentativas, v_criado_em',
].join('\n'))

// --- 3. a condicao que decide 'falhou' ---
const COND_DE = '        IF NOT p_transitorio OR v_tentativas + 1 >= c_max_tentativas THEN'
exigir(conta(fn, COND_DE) === 1, 'condicao do teto nao bateu')
fn = fn.replace(COND_DE, () =>
  '        IF NOT p_transitorio\n' +
  '           OR COALESCE(v_criado_em, now()) < now() - (c_max_dias_transitorio * interval \'1 day\') THEN')

// --- 3b. o comentario acima da condicao falava do teto de contagem, que deixou de existir ---
const COM_DE = "        -- RECUSA do equipamento (ou teto de tentativas atingido) e' definitiva: insistir a cada"
exigir(conta(fn, COM_DE) === 1, 'comentario da condicao nao bateu')
fn = fn.replace(COM_DE, () =>
  "        -- RECUSA do equipamento (ou item velho demais na fila) e' definitiva: insistir a cada")

// --- 4. espera crescente ganha teto ---
const ESP_DE = "               proxima_tentativa_em = now() + (interval '5 minutes' * (tentativas + 1))"
exigir(conta(fn, ESP_DE) === 1, 'calculo da proxima tentativa nao bateu')
fn = fn.replace(ESP_DE, () =>
  "               proxima_tentativa_em = now()\n" +
  "                 + LEAST(interval '5 minutes' * (tentativas + 1), c_espera_maxima)")

// invariantes do resultado
exigir(conta(fn, 'c_max_tentativas') === 0, 'sobrou referencia ao teto de contagem')
exigir(conta(fn, 'c_max_dias_transitorio') === 2, 'esperava 2x c_max_dias_transitorio (decl + uso)')
exigir(conta(fn, 'c_espera_maxima') === 2, 'esperava 2x c_espera_maxima (decl + uso)')
exigir(conta(fn, 'v_criado_em') === 3, 'esperava 3x v_criado_em (decl + select + uso)')
exigir(conta(fn, 'p_dispositivo_id IS NOT NULL AND v_dispositivo_id IS DISTINCT FROM p_dispositivo_id') === 1,
  'guard de dono da fila se perdeu na copia')
exigir(conta(fn, "status = 'enviado'") === 1, "status = 'enviado' se perdeu")
exigir(conta(fn, 'rep_vinculos_servidor') >= 1, 'criacao de vinculo se perdeu')

const CAB = fs.readFileSync('scratchpad/cab_transitorio_tempo.txt', 'utf8').replace(/\r\n/g, '\n')
const ROD = fs.readFileSync('scratchpad/rod_transitorio_tempo.txt', 'utf8').replace(/\r\n/g, '\n')
let out = CAB + '\n' + fn + '\n' + ROD
exigir(conta(out, '$fn$') % 2 === 0, 'delimitadores $fn$ desbalanceados')
exigir(conta(out, '$conf$') % 2 === 0, 'delimitadores $conf$ desbalanceados')
exigir(conta(out, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_cadastro_rep(') === 1, 'esperava 1 CREATE')

if (CRLF) out = out.replace(/\n/g, '\r\n')
fs.writeFileSync(SAIDA, out)
console.log('gerado:', SAIDA, '(' + out.length + ' bytes)')
