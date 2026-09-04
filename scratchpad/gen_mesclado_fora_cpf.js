/**
 * Gera 20260904140000_cadastro_mesclado_sai_das_checagens_de_cpf.sql.
 *
 * As duas funcoes sao COPIADAS do arquivo vigente e recebem UMA substituicao pontual cada
 * (armadilha 1 do CLAUDE.md: nao redigitar corpo de funcao a mao). Aborta se qualquer contagem
 * divergir - inclusive as do arquivo GERADO, conferidas no fim.
 */
const fs = require('fs')

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const NL = CR + LF

const fonte = fs.readFileSync(
  'supabase/migrations/20260810140000_relax_cpf_uniqueness_vinculo_multiplo.sql', 'utf8')
const fonteCpf = fs.readFileSync(
  'supabase/migrations/20260809110000_unique_servant_registration_by_cpf.sql', 'utf8')

function extrair(txt, inicio, fim, rotulo) {
  const i = txt.indexOf(inicio)
  if (i < 0) { console.error('nao achei o inicio de ' + rotulo); process.exit(1) }
  const j = txt.indexOf(fim, i)
  if (j < 0) { console.error('nao achei o fim de ' + rotulo); process.exit(1) }
  return txt.slice(i, j + fim.length)
}

function trocar(txt, de, para, rotulo) {
  const n = txt.split(de).length - 1
  if (n !== 1) { console.error(`[${rotulo}] esperava 1 ocorrencia, achei ${n}`); process.exit(1) }
  return txt.split(de).join(para)
}

// ---------------------------------------------------------------- fn_cpf_ja_cadastrado
let cpfFn = extrair(
  fonteCpf,
  'CREATE OR REPLACE FUNCTION public.fn_cpf_ja_cadastrado(',
  '$fn$;',
  'fn_cpf_ja_cadastrado',
)

cpfFn = trocar(
  cpfFn,
  '       AND (p_ignorar_id IS NULL OR s.id <> p_ignorar_id)',
  '       AND (p_ignorar_id IS NULL OR s.id <> p_ignorar_id)' + NL +
  '       -- Cadastro ja mesclado nao e duplicata pendente: ele E a duplicata, ja resolvida.' + NL +
  '       AND s.mesclado_em_servidor_id IS NULL',
  'fn_cpf_ja_cadastrado',
)

// ---------------------------------------------- fn_possiveis_duplicidades_servidor
let dupFn = extrair(
  fonte,
  'CREATE OR REPLACE FUNCTION public.fn_possiveis_duplicidades_servidor()',
  '$fn$;',
  'fn_possiveis_duplicidades_servidor',
)

dupFn = trocar(
  dupFn,
  '          FROM public.servidores s' + NL + '          LEFT JOIN public.unidades u ON u.id = s.unidade_id' + NL + '    ),',
  '          FROM public.servidores s' + NL +
  '          LEFT JOIN public.unidades u ON u.id = s.unidade_id' + NL +
  '         WHERE s.mesclado_em_servidor_id IS NULL' + NL +
  '    ),',
  'fn_possiveis_duplicidades_servidor',
)

// Invariantes do corpo copiado: o que NAO pode ter se perdido na copia.
const invariantes = [
  [dupFn, 'AND NOT (criterio = \'cpf\' AND bool_and(vinculo_multiplo_confirmado))', 'exclusao do vinculo multiplo confirmado'],
  [dupFn, "SELECT 'telefone', right(tel_norm, 11)", 'balde telefone'],
  [dupFn, "SELECT 'email', lower(btrim(email))", 'balde email'],
  [cpfFn, 'p_ignorar_id uuid DEFAULT NULL', 'parametro de ignorar o proprio registro'],
  [cpfFn, 'SECURITY DEFINER', 'security definer'],
]
for (const [txt, marca, rotulo] of invariantes) {
  if (!txt.includes(marca)) { console.error('INVARIANTE PERDIDO: ' + rotulo); process.exit(1) }
}

const cabecalho = `-- ============================================================================
-- CADASTRO MESCLADO SAI DAS CHECAGENS DE CPF DUPLICADO
-- ============================================================================
-- 04/09/2026 - complementa 20260904130000 (mesclagem de cadastros duplicados)
--
-- O DEFEITO, ACHADO NO PRIMEIRO USO REAL
--   fn_mesclar_servidores MOVE e INATIVA o cadastro duplicado; nao exclui, de proposito (a
--   matricula pode ter sido impressa em folha e escala). Mas as duas checagens de CPF do sistema
--   olham a tabela inteira, sem distinguir cadastro vivo de duplicata ja resolvida:
--
--     - fn_cpf_ja_cadastrado (20260809110000) e o portao de createServidor/updateServidor desde
--       que o indice unico de CPF foi derrubado (20260810140000). Depois de mesclar, editar o
--       cadastro que FICOU passava a acusar "Este CPF ja esta cadastrado para <a duplicata>" e
--       exigir a confirmacao de vinculo adicional - a MESMA caixa cujo uso indevido criou o
--       problema que a mesclagem acabou de desfazer. E como o cadastro mesclado nunca e apagado,
--       o bloqueio seria PARA SEMPRE;
--     - fn_possiveis_duplicidades_servidor continuaria listando o par (o mesclado + o que ficou)
--       como suspeita em /servidores/pendencias, tambem para sempre.
--
--   Medido em 04/09/2026, no caso que motivou a ferramenta: MARIA NAZARE (65567) foi mesclada com
--   T2600103 e, ao ser transferida para a unidade correta, a tela recusou por CPF duplicado
--   apontando para a propria duplicata inativada.
--
-- A CORRECAO
--   As duas funcoes passam a ignorar quem tem mesclado_em_servidor_id preenchido. O criterio e
--   esse, e nao "status = Inativo": servidor inativado por exoneracao continua sendo motivo
--   legitimo de alerta ao recadastrar o mesmo CPF - quem foi MESCLADO, nao, porque aquele
--   cadastro ja foi declarado duplicata de outro que existe.
--
-- COPIA MECANICA
--   Os dois corpos foram COPIADOS dos arquivos vigentes (20260809110000 e 20260810140000) por
--   scratchpad/gen_mesclado_fora_cpf.js, com uma substituicao pontual cada e conferencia de
--   invariantes - armadilha 1 do CLAUDE.md.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE nas duas (a lista de colunas de saida nao muda, entao nao ha 42P13).
-- ============================================================================


-- ============================================================================
-- 1. O PORTAO DE CADASTRO/EDICAO
-- ============================================================================

`

const meio = `

-- ============================================================================
-- 2. O DIAGNOSTICO DA TELA DE PENDENCIAS
-- ============================================================================

`

const rodape = `

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) O cadastro mesclado nao pode mais bloquear o que ficou. Esperado: 0 linhas.
--
--   SELECT * FROM public.fn_cpf_ja_cadastrado(
--       (SELECT cpf FROM public.servidores WHERE matricula = '65567'),
--       (SELECT id  FROM public.servidores WHERE matricula = '65567'));
--
--   2) ...e o par mesclado nao pode mais aparecer como duplicidade suspeita. Esperado: o CPF
--      93052707272 NAO consta no balde 'cpf'.
--
--   SELECT criterio, chave FROM public.fn_possiveis_duplicidades_servidor()
--    WHERE criterio = 'cpf';
--
--   3) Duplicata NAO mesclada continua sendo pega (a checagem nao pode ter sido afrouxada
--      demais). Esperado: as linhas dos CPFs que ainda tem dois cadastros vivos.
--
--   SELECT cpf, quantidade FROM public.fn_cadastros_duplicados();
`

const saida = cabecalho + cpfFn + meio + dupFn + rodape

// Conferencia estrutural do arquivo gerado.
const pares = (saida.match(/\$fn\$/g) || []).length
if (pares !== 4) { console.error('esperava 4 delimitadores $fn$, achei ' + pares); process.exit(1) }
if ((saida.match(/CREATE OR REPLACE FUNCTION/g) || []).length !== 2) { console.error('esperava 2 CREATE'); process.exit(1) }
if ((saida.match(/mesclado_em_servidor_id IS NULL/g) || []).length !== 2) { console.error('esperava 2 filtros novos'); process.exit(1) }

const destino = 'supabase/migrations/20260904140000_cadastro_mesclado_sai_das_checagens_de_cpf.sql'
fs.writeFileSync(destino, saida.split(LF).join(NL).split(CR + CR + LF).join(NL))
console.log('gerado: ' + destino)
console.log('  linhas: ' + saida.split(LF).length)
