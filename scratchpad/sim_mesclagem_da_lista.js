/**
 * Portao das duas regras novas de 06/09/2026 (nao ha framework de teste no projeto):
 *
 *   - mesclagemDoGrupoDuplicidade: quando a lista de "Possiveis duplicidades" oferece o caminho
 *     para a mesclagem, e quando ela NAO pode oferecer;
 *   - descreverEscalasFundidas: o relato da escala que mudou de lugar.
 *
 * Transpile antes:
 *   npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020
 * Rodar:
 *   node scratchpad/sim_mesclagem_da_lista.js
 */
const {
  mesclagemDoGrupoDuplicidade,
  descreverEscalasFundidas,
} = require('./_sim/mesclagemCadastro.js')

let passou = 0
const falhas = []

function ok(rotulo, condicao, detalhe) {
  if (condicao) { passou++; return }
  falhas.push(rotulo + (detalhe ? ' -- ' + detalhe : ''))
}

const grupoComAcao = (cpf) => ({ cpf, quantidade: 2, todos_confirmados: false, cadastros: [] })
const suspeito = (criterio, cpfs) => ({ criterio, servidores: cpfs.map(cpf => ({ cpf })) })

// ---------------------------------------------------------------------------
// 1. O caso dominante: agrupado por CPF, os dois lados com o mesmo CPF
// ---------------------------------------------------------------------------
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('cpf', ['00446031348', '00446031348']),
    [grupoComAcao('00446031348')])
  ok('CPF igual oferece mesclagem', r.cpf === '00446031348', JSON.stringify(r))
}

// Agrupado por NOME, mas com o mesmo CPF: mesclavel. Sao 16 dos 16 grupos por nome medidos em
// producao em 05/09/2026 -- travar por causa do rotulo do agrupamento esconderia todos eles.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['01873153104', '01873153104']),
    [grupoComAcao('01873153104')])
  ok('grupo por NOME com mesmo CPF e mesclavel', r.cpf === '01873153104', JSON.stringify(r))
}

// CPF com mascara de um lado e sem do outro continua sendo o mesmo CPF.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['004.460.313-48', '00446031348']),
    [grupoComAcao('00446031348')])
  ok('mascara nao separa o mesmo CPF', r.cpf === '00446031348', JSON.stringify(r))
}

// ...e o grupo com acao tambem pode vir mascarado.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('cpf', ['00446031348', '00446031348']),
    [grupoComAcao('004.460.313-48')])
  ok('mascara no grupo com acao nao impede', r.cpf === '00446031348', JSON.stringify(r))
}

// ---------------------------------------------------------------------------
// 2. O que NAO pode oferecer mesclagem -- e o motivo tem que sair escrito
// ---------------------------------------------------------------------------

// Telefone igual, CPF diferente: 3 dos 6 grupos por telefone medidos sao assim. Mesclar aqui
// junta DUAS PESSOAS, e o ponto de uma vira ponto da outra.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('telefone', ['00947018220', '00060573228']),
    [grupoComAcao('00947018220'), grupoComAcao('00060573228')])
  ok('CPF diferente NAO oferece mesclagem', r.cpf === undefined, JSON.stringify(r))
  ok('CPF diferente explica o motivo', /CPF diferente/.test(r.motivo || ''), r.motivo)
}

// E-mail compartilhado por 12 pessoas (existe em producao: c.s.d.ayres.a@gmail.com).
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('email', ['71908285249', '59016787100', '00855468289']),
    [grupoComAcao('71908285249')])
  ok('e-mail com varios CPFs nao oferece', r.cpf === undefined, JSON.stringify(r))
}

// Ninguem com CPF: sem CPF nao ha como afirmar que sao a mesma pessoa (a mesma regra que
// fn_impedimentos_mesclagem_servidor aplica no banco, com o motivo 'sem_cpf').
{
  const r = mesclagemDoGrupoDuplicidade(suspeito('nome', [null, null]), [])
  ok('sem CPF nos dois nao oferece', r.cpf === undefined, JSON.stringify(r))
  ok('sem CPF explica o motivo', /sem CPF/i.test(r.motivo || ''), r.motivo)
}

// Um lado sem CPF: os conjuntos divergem, entao cai na regra de CPF diferente -- e e o certo,
// porque um cadastro sem CPF pode ser de outra pessoa.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['00446031348', null]),
    [grupoComAcao('00446031348')])
  ok('um lado sem CPF nao oferece', r.cpf === undefined, JSON.stringify(r))
}

// CPF igual, mas o banco nao lista mais o grupo como duplicado (ja mesclado, ou um lado
// inativado). O diagnostico e mais amplo que a acao, e prometer o que nao existe e o defeito que
// a propria mesclagem veio corrigir.
{
  const r = mesclagemDoGrupoDuplicidade(suspeito('cpf', ['00446031348', '00446031348']), [])
  ok('sem grupo correspondente nao oferece', r.cpf === undefined, JSON.stringify(r))
  ok('sem grupo correspondente explica', /nada a mesclar/i.test(r.motivo || ''), r.motivo)
}

// Toda recusa tem motivo escrito: motivo vazio vira botao cinza sem explicacao.
{
  const recusas = [
    mesclagemDoGrupoDuplicidade(suspeito('nome', [null, null]), []),
    mesclagemDoGrupoDuplicidade(suspeito('telefone', ['1', '2']), []),
    mesclagemDoGrupoDuplicidade(suspeito('cpf', ['00446031348', '00446031348']), []),
  ]
  ok('toda recusa vem com motivo',
     recusas.every(r => typeof r.motivo === 'string' && r.motivo.length > 20),
     JSON.stringify(recusas))
}

// ---------------------------------------------------------------------------
// 3. Relato da escala fundida
// ---------------------------------------------------------------------------
{
  ok('sem fusao, nada a relatar', descreverEscalasFundidas([]).length === 0)
  ok('nulo nao quebra', descreverEscalasFundidas(null).length === 0)
  ok('indefinido nao quebra', descreverEscalasFundidas(undefined).length === 0)
}

{
  const linhas = descreverEscalasFundidas([
    { competencia: '09/2026', setor: 'HMM \\ CLINICA MEDICA', dias_movidos: 26 },
    { competencia: '10/2026', setor: 'HMM \\ CLINICA MEDICA', dias_movidos: 1 },
  ])
  ok('uma linha por competencia fundida', linhas.length === 2, JSON.stringify(linhas))
  ok('a linha diz competencia, setor e dias',
     /09\/2026/.test(linhas[0]) && /CLINICA MEDICA/.test(linhas[0]) && /26 dias/.test(linhas[0]),
     linhas[0])
  ok('um dia no singular', / 1 dia /.test(linhas[1]) && !/1 dias/.test(linhas[1]), linhas[1])
}

// Fusao que nao moveu dia nenhum ainda e relatada: escala vazia que deixou de existir e uma
// mudanca, e "0 dias" e honesto -- o que nao pode e a linha sumir do relato.
{
  const linhas = descreverEscalasFundidas([
    { competencia: '11/2026', setor: 'SMS \\ DMAC', dias_movidos: 0 },
  ])
  ok('fusao sem dia movido continua relatada', linhas.length === 1, JSON.stringify(linhas))
  ok('fusao sem dia movido diz zero', /0 dias/.test(linhas[0]), linhas[0])
}

// ---------------------------------------------------------------------------
console.log(`\n${passou} assercoes passaram, ${falhas.length} falharam`)
if (falhas.length) {
  console.log('\nFALHAS:')
  falhas.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
