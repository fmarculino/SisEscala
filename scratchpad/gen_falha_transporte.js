// Gera 20260909110000_fila_rep_falha_de_transporte_nao_reprova.sql a partir da migration VIGENTE
// de fn_cadastro_rep_reprovado (20260907100000). Copia mecanica: aborta se qualquer substituicao
// nao bater na contagem esperada. Nao redigite o corpo da funcao a mao (armadilha 1).
const fs = require('fs')
const FONTE = 'supabase/migrations/20260907100000_fila_rep_falha_superada_nao_reprova.sql'
const SAIDA = 'supabase/migrations/20260909110000_fila_rep_falha_de_transporte_nao_reprova.sql'

const src = fs.readFileSync(FONTE, 'utf8')
const CRLF = src.includes('\r\n')
const t = src.replace(/\r\n/g, '\n')
const conta = (h, n) => h.split(n).length - 1
function exigir(c, m) { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

// 1. Extrair o corpo VIGENTE da funcao.
const ini = t.indexOf('CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(')
exigir(ini >= 0, 'nao achei fn_cadastro_rep_reprovado em ' + FONTE)
const MARCA = '$fn$;'
const fim = t.indexOf(MARCA, ini)
exigir(fim > ini, 'nao achei o fechamento do dollar-quote')
let fn = t.slice(ini, fim + MARCA.length)

// Invariantes da fonte: as tres condicoes que a versao vigente ja tem e NAO podem se perder.
exigir(conta(fn, "f.status = 'falhou'") === 1, "esperava 1x f.status = 'falhou'")
exigir(conta(fn, "interval '30 days'") === 1, 'esperava 1x o teto de 30 dias')
exigir(conta(fn, 's.updated_at') === 1, 'esperava 1x s.updated_at')
exigir(conta(fn, 'dispositivos_rep_substituicoes') === 1, 'esperava 1x a clausula de substituicao')
exigir(conta(fn, "f2.status = 'enviado'") === 1, 'esperava 1x a clausula de falha superada')
exigir(conta(fn, 'SECURITY DEFINER') === 1, 'esperava SECURITY DEFINER')

// 2. Ancora: a ultima condicao do WHERE, logo antes do fechamento do EXISTS.
const ANCORA = [
  "                 '-infinity'::timestamptz)",
  '    );',
].join('\n')
exigir(conta(fn, ANCORA) === 1, 'esperava 1 ocorrencia da ancora de fechamento do EXISTS')

const CLAUSULA = [
  "                 '-infinity'::timestamptz)",
  '           -- (3) Falha de TRANSPORTE nao e recusa. O coletor so devolve `transitorio` para o',
  '           -- que ele RECONHECE como transporte (ciclo.ehFalhaDeTransporte), e ate a v0.17.0 a',
  '           -- lista de marcas nao cobria o erro mais comum que existe em campo: o `connectex`',
  '           -- do Windows, que e o unico SO onde o coletor roda. Consequencia medida no HMM em',
  '           -- 08/09/2026: o relogio HMM-04 ficou sem responder das 03h as 05h, 301 cadastros',
  '           -- foram gravados como `falhou`, e 277 pessoas ficaram permanentemente fora daquele',
  '           -- equipamento - o cron enfileira, esta funcao descarta, e ninguem ve.',
  '           --',
  '           -- Esta clausula fecha isso pelo lado do banco, e por isso NAO sai quando o coletor',
  '           -- for corrigido: ha coletor antigo instalado em campo (a atualizacao e automatica',
  '           -- mas tem atraso sorteado de ate 4h e depende da maquina estar ligada), e a fila ja',
  '           -- carrega 387 falhas gravadas por versoes que nao sabiam distinguir as duas coisas.',
  '           AND NOT public.fn_falha_rep_de_transporte(f.erro)',
  '    );',
].join('\n')

fn = fn.replace(ANCORA, () => CLAUSULA)
exigir(conta(fn, 'fn_falha_rep_de_transporte') === 1, 'a clausula (3) nao entrou')
// as condicoes anteriores continuam intactas
exigir(conta(fn, "f.status = 'falhou'") === 1, "clausula 'falhou' se perdeu na substituicao")
exigir(conta(fn, "interval '30 days'") === 1, 'teto de 30 dias se perdeu')
exigir(conta(fn, 's.updated_at') === 1, 's.updated_at se perdeu')
exigir(conta(fn, 'dispositivos_rep_substituicoes') === 1, 'clausula de substituicao se perdeu')
exigir(conta(fn, "f2.status = 'enviado'") === 1, 'clausula de falha superada se perdeu')

const CAB = fs.readFileSync('scratchpad/cab_falha_transporte.txt', 'utf8').replace(/\r\n/g, '\n')
const ROD = fs.readFileSync('scratchpad/rod_falha_transporte.txt', 'utf8').replace(/\r\n/g, '\n')

let out = CAB + '\n' + fn + '\n' + ROD
exigir(conta(out, '$fn$') % 2 === 0, 'delimitadores $fn$ desbalanceados')
exigir(conta(out, '$conf$') % 2 === 0, 'delimitadores $conf$ desbalanceados')
exigir(conta(out, 'CREATE OR REPLACE FUNCTION public.fn_cadastro_rep_reprovado(') === 1, 'esperava 1 CREATE da funcao alvo')
exigir(conta(out, 'GRANT  EXECUTE ON FUNCTION public.fn_cadastro_rep_reprovado(uuid, uuid)') === 1, 'esperava 1 GRANT da funcao alvo')

if (CRLF) out = out.replace(/\n/g, '\r\n')
fs.writeFileSync(SAIDA, out)
console.log('gerado:', SAIDA, '(' + out.length + ' bytes)')
