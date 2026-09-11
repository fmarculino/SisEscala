/**
 * Portao das regras de tela da mesclagem (nao ha framework de teste no projeto):
 *
 *   - mesclagemDoGrupoDuplicidade: quando a lista de "Possiveis duplicidades" oferece o caminho
 *     para a mesclagem, quando oferece a mesclagem DECLARADA (CPF divergente, 11/09/2026) e
 *     quando nao pode oferecer nada;
 *   - conferirMotivoDeclaracao e avisosDaDeclaracao: o que a tela exige e diz antes de alguem
 *     declarar que dois cadastros de CPF diferente sao a mesma pessoa;
 *   - descreverEscalasFundidas: o relato da escala que mudou de lugar.
 *
 * Transpile antes:
 *   npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020
 * Rodar:
 *   node scratchpad/sim_mesclagem_da_lista.js
 */
const {
  mesclagemDoGrupoDuplicidade,
  conferirMotivoDeclaracao,
  avisosDaDeclaracao,
  descreverEscalasFundidas,
  MOTIVO_DECLARACAO_MINIMO,
} = require('./_sim/mesclagemCadastro.js')

let passou = 0
const falhas = []

function ok(rotulo, condicao, detalhe) {
  if (condicao) { passou++; return }
  falhas.push(rotulo + (detalhe ? ' -- ' + detalhe : ''))
}

const grupoComAcao = (cpf) => ({ cpf, quantidade: 2, todos_confirmados: false, cadastros: [] })

/** Cadastros do grupo de diagnostico. Por padrao Ativos, que e' o caso da lista. */
const suspeito = (criterio, cpfs, opcoes = {}) => ({
  criterio,
  servidores: cpfs.map((cpf, i) => ({
    id: `id-${i}`,
    nome: opcoes.nome || 'FULANA DE TAL',
    matricula: opcoes.matriculas ? opcoes.matriculas[i] : `${1000 + i}`,
    cpf,
    status: opcoes.status ? opcoes.status[i] : 'Ativo',
    unidade: 'SMS',
  })),
})

// ---------------------------------------------------------------------------
// 1. O caso dominante: agrupado por CPF, os dois lados com o mesmo CPF
// ---------------------------------------------------------------------------
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('cpf', ['00446031348', '00446031348']),
    [grupoComAcao('00446031348')])
  ok('CPF igual oferece mesclagem', r.tipo === 'atalho' && r.cpf === '00446031348', JSON.stringify(r))
}

// Agrupado por NOME, mas com o mesmo CPF: mesclavel. Sao 61 dos 62 grupos por nome medidos em
// producao em 11/09/2026 -- travar por causa do rotulo do agrupamento esconderia todos eles.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['01873153104', '01873153104']),
    [grupoComAcao('01873153104')])
  ok('grupo por NOME com mesmo CPF e mesclavel', r.tipo === 'atalho' && r.cpf === '01873153104', JSON.stringify(r))
}

// CPF com mascara de um lado e sem do outro continua sendo o mesmo CPF.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['004.460.313-48', '00446031348']),
    [grupoComAcao('00446031348')])
  ok('mascara nao separa o mesmo CPF', r.tipo === 'atalho' && r.cpf === '00446031348', JSON.stringify(r))
}

// ...e o grupo com acao tambem pode vir mascarado.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('cpf', ['00446031348', '00446031348']),
    [grupoComAcao('004.460.313-48')])
  ok('mascara no grupo com acao nao impede', r.tipo === 'atalho' && r.cpf === '00446031348', JSON.stringify(r))
}

// ---------------------------------------------------------------------------
// 2. MESCLAGEM DECLARADA (11/09/2026): nome identico com CPF divergente
// ---------------------------------------------------------------------------
// O caso real: SAMU-SMS, dois cadastros criados com 25 min de diferenca, um com matricula
// temporaria, aberto com o CPF de outra pessoa. Antes disto nao havia caminho nenhum -- a
// mensagem mandava "corrigir o CPF na ficha", o que esbarra em fn_cpf_ja_cadastrado.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['51938413253', '02452771295'], { matriculas: ['54546', 'T2600120'] }),
    [])
  ok('nome identico com CPF divergente oferece a DECLARACAO', r.tipo === 'declarar', JSON.stringify(r))
  ok('a declaracao carrega os dois cadastros', (r.servidores || []).length === 2, JSON.stringify(r))
}

// 🚨 E o oposto, que e o que protege: TELEFONE com CPF divergente NAO oferece nada. Medido em
// producao: 6 dos 10 grupos com CPF divergente sao por telefone. Telefone de familia ou de setor
// nao diz nada sobre identidade -- mesclar ali junta DUAS PESSOAS, e o ponto de uma vira ponto
// da outra.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('telefone', ['00947018220', '00060573228']),
    [grupoComAcao('00947018220'), grupoComAcao('00060573228')])
  ok('telefone com CPF diferente NAO oferece mesclagem', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('telefone explica que o dado e compartilhado', /telefone/i.test(r.motivo || ''), r.motivo)
  ok('telefone nao vira declaracao', r.tipo !== 'declarar', JSON.stringify(r))
}

// E-mail compartilhado por 12 pessoas (existe em producao: um endereco para 12 CPFs).
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('email', ['71908285249', '59016787100', '00855468289']),
    [grupoComAcao('71908285249')])
  ok('e-mail com varios CPFs nao oferece', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('e-mail explica que o dado e compartilhado', /e-mail/i.test(r.motivo || ''), r.motivo)
}

// Tres ou mais cadastros com CPFs diferentes entre si: nao da para dizer QUAL par e a mesma
// pessoa, e escolher errado move o ponto de alguem.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['51938413253', '02452771295', '00446031348']),
    [])
  ok('tres cadastros com CPF divergente nao viram declaracao', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('o motivo diz quantos sao', /3 cadastros/.test(r.motivo || ''), r.motivo)
}

// Um dos lados ja inativado: nao e duplicidade em aberto.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['51938413253', '02452771295'], { status: ['Ativo', 'Inativo'] }),
    [])
  ok('cadastro inativo nao vira declaracao', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('inativo explica o motivo', /Ativo/i.test(r.motivo || ''), r.motivo)
}

// CPF incompleto de um lado: sem CPF valido nos dois nao ha nem o que declarar.
{
  const r = mesclagemDoGrupoDuplicidade(suspeito('nome', ['51938413253', '123']), [])
  ok('CPF invalido nao vira declaracao', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('CPF invalido explica o motivo', /CPF/.test(r.motivo || ''), r.motivo)
}

// Ninguem com CPF: a mesma regra que fn_impedimentos_mesclagem_servidor aplica no banco com o
// motivo 'sem_cpf', que continua DURO mesmo na declaracao.
{
  const r = mesclagemDoGrupoDuplicidade(suspeito('nome', [null, null]), [])
  ok('sem CPF nos dois nao oferece', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('sem CPF explica o motivo', /sem CPF/i.test(r.motivo || ''), r.motivo)
}

// Um lado sem CPF nenhum: nao e "CPF divergente", e um cadastro incompleto.
{
  const r = mesclagemDoGrupoDuplicidade(
    suspeito('nome', ['00446031348', null]),
    [grupoComAcao('00446031348')])
  ok('um lado sem CPF nao oferece', r.tipo === 'indisponivel', JSON.stringify(r))
}

// CPF igual, mas o banco nao lista mais o grupo como duplicado (ja mesclado, ou um lado
// inativado). O diagnostico e mais amplo que a acao, e prometer o que nao existe e o defeito que
// a propria mesclagem veio corrigir.
{
  const r = mesclagemDoGrupoDuplicidade(suspeito('cpf', ['00446031348', '00446031348']), [])
  ok('sem grupo correspondente nao oferece', r.tipo === 'indisponivel', JSON.stringify(r))
  ok('sem grupo correspondente explica', /nada a mesclar/i.test(r.motivo || ''), r.motivo)
}

// Toda recusa tem motivo escrito: motivo vazio vira botao cinza sem explicacao (armadilha 31).
{
  const recusas = [
    mesclagemDoGrupoDuplicidade(suspeito('nome', [null, null]), []),
    mesclagemDoGrupoDuplicidade(suspeito('telefone', ['00947018220', '00060573228']), []),
    mesclagemDoGrupoDuplicidade(suspeito('email', ['00947018220', '00060573228']), []),
    mesclagemDoGrupoDuplicidade(suspeito('cpf', ['00446031348', '00446031348']), []),
    mesclagemDoGrupoDuplicidade(suspeito('nome', ['51938413253', '123']), []),
  ]
  ok('toda recusa vem com motivo',
     recusas.every(r => r.tipo === 'indisponivel' && typeof r.motivo === 'string' && r.motivo.length > 20),
     JSON.stringify(recusas))
}

// ---------------------------------------------------------------------------
// 3. O motivo escrito da declaracao — espelho da regra do banco
// ---------------------------------------------------------------------------
{
  ok('motivo vazio recusado', conferirMotivoDeclaracao('').ok === false)
  ok('motivo nulo recusado', conferirMotivoDeclaracao(null).ok === false)
  ok('motivo curto recusado', conferirMotivoDeclaracao('engano').ok === false)
  ok('so espacos recusado', conferirMotivoDeclaracao('               ').ok === false)
  ok('recusa explica o minimo',
     new RegExp(String(MOTIVO_DECLARACAO_MINIMO)).test(conferirMotivoDeclaracao('x').erro || ''),
     conferirMotivoDeclaracao('x').erro)
  ok('motivo de 10 caracteres passa', conferirMotivoDeclaracao('1234567890').ok === true)
  ok('motivo real passa',
     conferirMotivoDeclaracao('recadastrada por engano com o CPF de outra servidora').ok === true)
  // Espaco duplo nao inflа o tamanho: o banco colapsa igual, e contas diferentes fariam a tela
  // liberar o botao para uma chamada que a RPC recusa.
  ok('espaco duplo nao infla o tamanho', conferirMotivoDeclaracao('a  b  c').ok === false,
     JSON.stringify(conferirMotivoDeclaracao('a  b  c')))
}

// ---------------------------------------------------------------------------
// 4. O aviso da declaracao — a identidade inteira, nunca so o CPF
// ---------------------------------------------------------------------------
{
  const div = [
    { campo: 'cpf', rotulo: 'CPF', valor_origem: '024', valor_destino: '519' },
    { campo: 'pis_pasep', rotulo: 'PIS/PASEP', valor_origem: '148', valor_destino: '267' },
    { campo: 'data_nascimento', rotulo: 'data de nascimento', valor_origem: '2001-12-10', valor_destino: '1981-06-08' },
    { campo: 'nome_mae', rotulo: 'nome da mae', valor_origem: 'DACILENE', valor_destino: 'RAIMUNDA' },
  ]
  const avisos = avisosDaDeclaracao(div)
  const texto = avisos.join(' ')
  ok('o aviso cita os campos alem do CPF',
     /PIS\/PASEP/.test(texto) && /data de nascimento/.test(texto) && /nome da mae/.test(texto), texto)
  ok('o aviso levanta a hipotese de ficha trocada', /outra pessoa/i.test(texto), texto)
  ok('o aviso diz que nenhum dado pessoal e copiado', /n[aã]o copia/i.test(texto), texto)
}

// So o CPF divergindo: nao inventa lista de campos, mas continua avisando sobre a copia.
{
  const avisos = avisosDaDeclaracao([
    { campo: 'cpf', rotulo: 'CPF', valor_origem: '024', valor_destino: '519' },
  ])
  ok('so CPF divergente nao lista outros campos',
     !avisos.some(a => /Além do CPF/.test(a)), JSON.stringify(avisos))
  ok('so CPF divergente ainda avisa sobre a copia',
     avisos.some(a => /n[aã]o copia/i.test(a)), JSON.stringify(avisos))
}

// ---------------------------------------------------------------------------
// 5. Relato da escala fundida
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
