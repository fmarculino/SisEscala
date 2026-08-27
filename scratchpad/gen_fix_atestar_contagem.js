/**
 * Anexa a 20260827020000 a correcao de fn_atestar_jornada_bulk: ela le `total_processed`, e
 * fn_confirmar_presenca_manual_bulk sempre devolveu `processed_count`.
 *
 * Copia MECANICA do corpo vigente (20260808130000) — armadilha 1 do CLAUDE.md. Aborta em
 * qualquer contagem divergente.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const VIGENTE = '20260808130000_solicitacao_de_ajuste_pelo_servidor.sql'
const ALVO = '20260827020000_autorizacoes_ponto_coletivo.sql'

const fonte = fs.readFileSync(path.join(DIR, VIGENTE), 'utf8')

const ini = fonte.indexOf('CREATE OR REPLACE FUNCTION public.fn_atestar_jornada_bulk(')
if (ini < 0) throw new Error('funcao nao encontrada em ' + VIGENTE)
const fim = fonte.indexOf('$fn$;', ini)
if (fim < 0) throw new Error('fim da funcao nao encontrado')
let fn = fonte.slice(ini, fim + '$fn$;'.length)

const conta = (t, p) => t.split(p).length - 1
const checar = (rot, v, e) => { if (v !== e) throw new Error(`${rot}: esperado ${e}, achou ${v}`) }

// Invariantes ANTES
checar('delega para o bulk', conta(fn, 'public.fn_confirmar_presenca_manual_bulk('), 1)
checar('le a chave errada', conta(fn, "v_res->>'total_processed'"), 1)
checar('varredura de pendentes', conta(fn, 'pendente de revisao'), 1)
checar('exige justificativa', conta(fn, 'Justificativa é obrigatória'), 1)
checar('delimitadores', conta(fn, '$fn$'), 2)

// A UNICA troca
fn = fn.split("v_res->>'total_processed'").join("v_res->>'processed_count'")

// Invariantes DEPOIS
checar('chave corrigida', conta(fn, "v_res->>'processed_count'"), 1)
checar('chave antiga sumiu', conta(fn, "v_res->>'total_processed'"), 0)
checar('delega para o bulk (depois)', conta(fn, 'public.fn_confirmar_presenca_manual_bulk('), 1)
checar('varredura de pendentes (depois)', conta(fn, 'pendente de revisao'), 1)
checar('delimitadores (depois)', conta(fn, '$fn$'), 2)
checar('CREATE unico', conta(fn, 'CREATE OR REPLACE FUNCTION'), 1)

const BLOCO = `

-- ============================================================================
-- 6. CORRECAO: fn_atestar_jornada_bulk contava com a chave errada
-- ============================================================================
-- Achado ao escrever a secao 5, em 27/08/2026. fn_confirmar_presenca_manual_bulk devolve
-- \`processed_count\` (assim desde 20260804040000) e fn_atestar_jornada_bulk le
-- \`total_processed\`, que nunca existiu — nas duas versoes dela (20260808120000 e
-- 20260808130000).
--
-- Efeito: o COALESCE resolve para 0 sempre, entao a validacao em massa funciona e ANUNCIA
-- "Jornada atestada em 0 registro(s)". Nada e' gravado errado; o que quebra e' a confianca de
-- quem clicou — e e' a mesma familia da armadilha 22 do CLAUDE.md (relatar o que foi calculado
-- em vez do que mudou), aqui na forma pior: relatar zero quando mudou.
--
-- Copia mecanica do corpo vigente (20260808130000) com UMA substituicao, conferida por
-- scratchpad/gen_fix_atestar_contagem.js.

${fn}

GRANT EXECUTE ON FUNCTION public.fn_atestar_jornada_bulk(uuid[], integer[], text[], text, uuid, text)
    TO authenticated, service_role;

--   7) A contagem passa a bater (rodar sobre um dia sem batida pendente):
--
--   SELECT public.fn_atestar_jornada_bulk(ARRAY['<em>']::uuid[], ARRAY[<dia>],
--          ARRAY['Regular'], 'completo', '<validador>', 'teste de contagem');
--   -- esperado: atestados > 0 na resposta (antes vinha 0 mesmo tendo gravado)
`

const alvoPath = path.join(DIR, ALVO)
let alvo = fs.readFileSync(alvoPath, 'utf8')
if (alvo.includes('CREATE OR REPLACE FUNCTION public.fn_atestar_jornada_bulk')) throw new Error('bloco ja anexado')

const crlf = alvo.includes('\r\n')
alvo = alvo + (crlf ? BLOCO.replace(/\n/g, '\r\n') : BLOCO)
fs.writeFileSync(alvoPath, alvo)

// Conferencia estrutural do arquivo inteiro
const final = fs.readFileSync(alvoPath, 'utf8')
if (conta(final, '$fn$') % 2 !== 0) throw new Error('delimitadores $fn$ fora de par no arquivo')
console.log('anexado. $fn$ no arquivo:', conta(final, '$fn$'), '| linhas:', final.split(/\r?\n/).length)
