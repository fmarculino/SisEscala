/**
 * Portao: troca de turno em linha Regular (10/09/2026).
 *
 * Transpile antes:
 *   npx tsc src/utils/justificativaEvento.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Cobre as tres pontas do conserto:
 *   1. a regra em si (espelho da CHECK do banco);
 *   2. o TEXTO das telas — nenhuma frase pode prometer relatorio para categoria que nao tem;
 *   3. a MIGRATION — o guard existe e as duas escritas em justificativas_eventos estao dentro dele.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const M = require('./_sim/justificativaEvento.js')

let ok = 0
const falhas = []
function eq(rotulo, obtido, esperado) {
  if (obtido === esperado) { ok++; return }
  falhas.push(`${rotulo}: esperava ${JSON.stringify(esperado)}, obtive ${JSON.stringify(obtido)}`)
}
function verdade(rotulo, cond) { eq(rotulo, !!cond, true) }
function falso(rotulo, cond) { eq(rotulo, !!cond, false) }

// ---------------------------------------------------------------------------
// 1. A regra. Espelho EXATO de justificativas_eventos_categoria_check.
// ---------------------------------------------------------------------------
falso('Regular nao tem justificativa de evento', M.categoriaTemJustificativaEvento('Regular'))
for (const c of ['Extra', 'Plantão', 'Sobreaviso']) {
  verdade(`${c} tem justificativa de evento`, M.categoriaTemJustificativaEvento(c))
}
// Sem normalizar acento nem caixa: aceitar aqui so adiantaria o INSERT ate a CHECK, que e literal.
for (const c of ['plantao', 'Plantao', 'PLANTÃO', 'extra', 'sobreaviso', '', null, undefined]) {
  falso(`variante ${JSON.stringify(c)} nao pode ser aceita`, M.categoriaTemJustificativaEvento(c))
}
eq('a lista tem exatamente 3 categorias', M.CATEGORIAS_COM_JUSTIFICATIVA_EVENTO.length, 3)

// ---------------------------------------------------------------------------
// 2. O que a tela diz. Prometer relatorio inexistente e o defeito que motivou tudo.
// ---------------------------------------------------------------------------
const destinoRegular = M.destinoDaJustificativaTurno('Regular')
verdade('Regular: a frase cita o historico', /histórico/i.test(destinoRegular))
falso('Regular: a frase NAO promete relatorio de Regular', /relatório de (justificativas de )?Regular/i.test(destinoRegular))
verdade('Regular: a frase explica o que o relatorio cobre', /Hora Extra/i.test(destinoRegular))

const destinoPlantao = M.destinoDaJustificativaTurno('Plantão')
verdade('Plantao: a frase promete o relatorio', /relatório/i.test(destinoPlantao) && /Plantão/.test(destinoPlantao))

const aplicadaRegular = M.descreverTrocaAplicada({
  servidorNome: 'FULANA', dia: 3, codigoAnterior: 'MT', codigoNovo: 'M', categoria: 'Regular'
})
verdade('confirmacao Regular: diz o de -> para', aplicadaRegular.includes('MT → M'))
falso('confirmacao Regular: NAO promete relatorio', /relatório/i.test(aplicadaRegular))
verdade('confirmacao Regular: diz que o ponto foi preservado', /preservadas/.test(aplicadaRegular))

const aplicadaPlantao = M.descreverTrocaAplicada({
  servidorNome: 'FULANA', dia: 3, codigoAnterior: 'T', codigoNovo: 'TN', categoria: 'Plantão'
})
verdade('confirmacao Plantao: promete o relatorio', /relatório de justificativas de Plantão/.test(aplicadaPlantao))

// Turno anterior vazio nao pode virar "undefined" no texto mostrado ao coordenador.
const semAnterior = M.descreverTrocaAplicada({
  servidorNome: 'FULANA', dia: 1, codigoAnterior: '', codigoNovo: 'M', categoria: 'Regular'
})
falso('sem turno anterior: nao vaza undefined', /undefined/.test(semAnterior))

// ---------------------------------------------------------------------------
// 3. Os sitios. Nenhuma tela pode voltar a interpolar a categoria num "relatorio de".
// ---------------------------------------------------------------------------
const grade = fs.readFileSync(
  path.join(RAIZ, 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'), 'utf8')
falso('ScaleGrid: nenhum "relatório de ${categoria}" interpolado',
  /relatório de \$\{[^}]*categoria[^}]*\}|relatório de \{[^}]*categoria[^}]*\}/i.test(grade))
verdade('ScaleGrid: usa a fonte unica no modal', grade.includes('destinoDaJustificativaTurno(trocaTurnoModal.categoria)'))
verdade('ScaleGrid: usa a fonte unica na confirmacao', grade.includes('descreverTrocaAplicada({'))

// ---------------------------------------------------------------------------
// 4. A migration. O guard existe e as escritas estao DENTRO dele.
// ---------------------------------------------------------------------------
const mig = fs.readFileSync(
  path.join(RAIZ, 'supabase/migrations/20260910120000_troca_de_turno_em_linha_regular.sql'), 'utf8')

const guard = 'IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN'
verdade('migration: o guard existe', mig.includes(guard))
const posGuard = mig.indexOf(guard)
const posFim = mig.indexOf('    END IF;', mig.indexOf('v_evento_justificado := true;'))
for (const escrita of ['INSERT INTO public.justificativas_eventos', 'UPDATE public.justificativas_eventos']) {
  const p = mig.indexOf(escrita)
  verdade(`migration: ${escrita.split(' ')[0]} dentro do guard`, p > posGuard && p < posFim)
}
// A funcao SQL espelha a mesma lista - e nao inclui Regular.
verdade('migration: a funcao lista as 3 categorias de evento',
  /ARRAY\['Extra', 'Plantão', 'Sobreaviso'\]/.test(mig))
falso('migration: Regular nao entrou na lista da funcao',
  /ARRAY\[[^\]]*'Regular'[^\]]*\]\s*\);\s*\$fncat\$/.test(mig))
// Guards que a copia mecanica nao pode ter perdido (armadilha 1).
for (const inv of ['sisescala.justificativa_turno', "IF v_status = 'Fechada' THEN",
                   'Justificativa obrigatoria', 'SECURITY INVOKER']) {
  verdade(`migration: preservou ${inv}`, mig.includes(inv))
}
// A conferencia precisa EXECUTAR (armadilha 42), nao so olhar catalogo.
verdade('migration: a conferencia executa a funcao nova',
  mig.includes("public.fn_categoria_tem_justificativa_evento('Regular')"))
verdade('migration: a conferencia avalia a CHECK real', mig.includes('pg_get_constraintdef'))

// ---------------------------------------------------------------------------
if (falhas.length) {
  console.error(`REPROVADO: ${falhas.length} falha(s), ${ok} ok`)
  for (const f of falhas) console.error('  - ' + f)
  process.exit(1)
}
console.log(`OK: ${ok} asserções`)
