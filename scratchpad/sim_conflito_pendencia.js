/**
 * Portao de src/utils/pendenciaRh/conflitoCadastro.ts.
 *
 * Transpile antes:
 *   npx tsc src/utils/pendenciaRh/conflitoCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Roda: node scratchpad/sim_conflito_pendencia.js
 */
const path = require('path')
const M = require(path.join(__dirname, '_sim', 'conflitoCadastro.js'))
const { avaliarAcao, opcoesDoConflito, recusaPorCpfJaCadastrado } = M

let ok = 0
const falhas = []
function certo(condicao, descricao) {
  if (condicao) { ok++; return }
  falhas.push(descricao)
}

const conflitoCpf = (over = {}) => ({
  tipo: 'cpf',
  servidor_id: 'aaa',
  nome: 'NEZILDA RIBEIRO DE SOUZA',
  matricula: '68182',
  unidade_nome: 'HMI - Hospital Materno Infantil',
  status: 'Ativo',
  alvo_no_escopo: false,
  ...over,
})
const conflitoMat = (over = {}) => conflitoCpf({ tipo: 'matricula', ...over })

const base = {
  conferencia: { estado: 'ok', cpfPendencia: '02535278138', conflito: null },
  escolha: null,
  camposCompletos: true,
  cpfInformado: true,
  salvando: false,
}
const acao = over => avaliarAcao({ ...base, ...over })

// ---------------------------------------------------------------------------
// 1. Conferencia: os TRES estados levam a coisas diferentes
// ---------------------------------------------------------------------------
{
  const a = acao({ conferencia: { estado: 'conferindo' } })
  certo(!a.habilitado, 'conferindo: botao desabilitado')
  certo(a.rotulo === 'Verificando...', 'conferindo: rotulo')
  certo(a.caminho === null, 'conferindo: sem caminho')
}
{
  // O DEFEITO DE 16/09/2026: falha nao pode virar "segue em frente".
  const a = acao({ conferencia: { estado: 'falhou', motivo: 'Pendência não encontrada.' } })
  certo(!a.habilitado, 'falhou: botao DESABILITADO - nunca decidir as cegas')
  certo(a.caminho === null, 'falhou: nenhum caminho de escrita')
  certo(/n[aã]o foi poss[ií]vel conferir/i.test(a.rotulo), 'falhou: rotulo diz que nao conferiu')
  certo(!!a.motivo && a.motivo.includes('Pendência não encontrada.'), 'falhou: motivo repassa o erro do banco')
}
{
  const a = acao({})
  certo(a.habilitado && a.caminho === 'promover', 'ok sem conflito: promove')
  certo(a.rotulo === 'Confirmar cadastro', 'ok sem conflito: rotulo')
  certo(a.motivo === null, 'ok sem conflito: sem motivo de bloqueio')
}
{
  const a = acao({ salvando: true })
  certo(!a.habilitado && a.rotulo === 'Gravando...', 'salvando: desabilita')
}

// ---------------------------------------------------------------------------
// 2. Campos obrigatorios para CRIAR cadastro
// ---------------------------------------------------------------------------
{
  const a = acao({ camposCompletos: false })
  certo(!a.habilitado, 'sem unidade/setor/cargo: desabilitado')
  certo(!!a.motivo && /unidade/i.test(a.motivo), 'sem campos: motivo nomeia o que falta')
}
{
  const a = acao({ cpfInformado: false })
  certo(!a.habilitado && /CPF/.test(a.motivo || ''), 'sem CPF: desabilitado com motivo')
}

// ---------------------------------------------------------------------------
// 3. Conflito por CPF - as duas opcoes
// ---------------------------------------------------------------------------
{
  const conferencia = { estado: 'ok', cpfPendencia: '02535278138', conflito: conflitoCpf() }
  const a = acao({ conferencia })
  certo(!a.habilitado, 'conflito cpf sem escolha: desabilitado')
  certo(/escolha uma op/i.test(a.rotulo), 'conflito cpf sem escolha: pede a escolha')

  const o = opcoesDoConflito(conflitoCpf())
  certo(o.exigeEscolha, 'conflito cpf: exige escolha')
  certo(o.vinculoAdicional.disponivel, 'conflito cpf: vinculo adicional disponivel')
}
{
  // O CASO DO PRINT: pendencia do CAPS III colidindo com cadastro do HMI. "Atualizar" e
  // impossivel (fora do escopo) e "vinculo adicional" TEM que estar disponivel - era a resposta
  // que a tela nunca oferecia.
  const conferencia = { estado: 'ok', cpfPendencia: '02535278138', conflito: conflitoCpf() }
  const a = acao({ conferencia, escolha: 'duplo' })
  certo(a.habilitado, 'caso do print: vinculo adicional HABILITADO')
  certo(a.caminho === 'promover_vinculo_adicional', 'caso do print: caminho de vinculo adicional')
  certo(/v[ií]nculo adicional/i.test(a.rotulo), 'caso do print: rotulo nomeia vinculo adicional')

  const b = acao({ conferencia, escolha: 'atualizar' })
  certo(!b.habilitado, 'caso do print: atualizar fora do escopo fica DESABILITADO')
  certo(b.caminho === null, 'caso do print: atualizar fora do escopo nao tem caminho')
  certo(!!b.motivo && b.motivo.includes('HMI - Hospital Materno Infantil'),
    'caso do print: o motivo NOMEIA a unidade do cadastro existente')
  certo(/fora do seu escopo/i.test(b.motivo), 'caso do print: o motivo explica o impedimento')
}
{
  const conferencia = { estado: 'ok', cpfPendencia: null, conflito: conflitoCpf({ alvo_no_escopo: true }) }
  const a = acao({ conferencia, escolha: 'atualizar', camposCompletos: false, cpfInformado: false })
  certo(a.habilitado && a.caminho === 'atualizar',
    'atualizar no escopo: nao exige unidade/setor/cargo nem CPF - nao cria cadastro')
}
{
  const conferencia = { estado: 'ok', cpfPendencia: null, conflito: conflitoCpf() }
  const a = acao({ conferencia, escolha: 'duplo', camposCompletos: false })
  certo(!a.habilitado, 'vinculo adicional sem campos: desabilitado')
  certo(!!a.motivo, 'vinculo adicional sem campos: com motivo')
}

// ---------------------------------------------------------------------------
// 4. Conflito por MATRICULA - nunca e vinculo adicional
// ---------------------------------------------------------------------------
{
  const o = opcoesDoConflito(conflitoMat({ alvo_no_escopo: true }))
  certo(!o.vinculoAdicional.disponivel, 'matricula: cadastro novo indisponivel')
  certo(/[uú]nica por pessoa/i.test(o.vinculoAdicional.motivo || ''), 'matricula: motivo explica que e o mesmo registro')
  certo(!o.exigeEscolha, 'matricula: nao pede escolha - so ha um caminho')
  certo(o.atualizar.disponivel, 'matricula no escopo: atualizar disponivel')
}
{
  const conferencia = { estado: 'ok', cpfPendencia: null, conflito: conflitoMat({ alvo_no_escopo: true }) }
  const a = acao({ conferencia, escolha: null })
  certo(a.habilitado && a.caminho === 'atualizar',
    'matricula no escopo: segue direto para atualizar, mesmo sem radio marcado')
}
{
  // Matricula colidindo com cadastro fora do escopo: nao ha caminho nenhum, e a tela tem que
  // DIZER isso em vez de mostrar um botao cinza mudo.
  const conferencia = { estado: 'ok', cpfPendencia: null, conflito: conflitoMat() }
  const a = acao({ conferencia, escolha: null })
  certo(!a.habilitado, 'matricula fora do escopo: desabilitado')
  certo(a.caminho === null, 'matricula fora do escopo: sem caminho')
  certo(!!a.motivo && a.motivo.length > 20, 'matricula fora do escopo: motivo escrito')
  certo(a.motivo.includes('HMI - Hospital Materno Infantil'), 'matricula fora do escopo: motivo nomeia a unidade')
}

// ---------------------------------------------------------------------------
// 5. Sem conflito: nenhuma opcao de conflito aparece
// ---------------------------------------------------------------------------
{
  const o = opcoesDoConflito(null)
  certo(!o.atualizar.disponivel && !o.vinculoAdicional.disponivel && !o.exigeEscolha,
    'sem conflito: nenhuma opcao de conflito')
  certo(o.atualizar.motivo === null, 'sem conflito: sem motivo fabricado')
}

// ---------------------------------------------------------------------------
// 6. INVARIANTE: botao desabilitado por impedimento sempre tem motivo escrito
// ---------------------------------------------------------------------------
{
  const cenarios = []
  for (const conflito of [null, conflitoCpf(), conflitoCpf({ alvo_no_escopo: true }), conflitoMat(), conflitoMat({ alvo_no_escopo: true })]) {
    for (const escolha of [null, 'atualizar', 'duplo']) {
      for (const camposCompletos of [true, false]) {
        for (const cpfInformado of [true, false]) {
          cenarios.push({ conferencia: { estado: 'ok', cpfPendencia: null, conflito }, escolha, camposCompletos, cpfInformado })
        }
      }
    }
  }
  const mudos = cenarios.filter(c => {
    const a = acao(c)
    // "Escolha uma opcao acima" e auto-explicativo; os demais bloqueios precisam de motivo.
    return !a.habilitado && !a.motivo && !/escolha uma op/i.test(a.rotulo)
  })
  certo(mudos.length === 0, `todo bloqueio tem motivo ou rotulo auto-explicativo (${mudos.length} mudos em ${cenarios.length})`)

  // E nenhum cenario habilita um caminho que o banco recusaria.
  const indevidos = cenarios.filter(c => {
    const a = acao(c)
    const conf = c.conferencia.conflito
    if (a.caminho === 'atualizar' && conf && !conf.alvo_no_escopo) return true
    if (a.caminho === 'promover_vinculo_adicional' && conf && conf.tipo === 'matricula') return true
    if (a.caminho === 'promover' && conf) return true
    return false
  })
  certo(indevidos.length === 0, `nenhum cenario habilita caminho que o banco recusaria (${indevidos.length})`)
}

// ---------------------------------------------------------------------------
// 7. Reconhecer a recusa do banco (a pergunta que precisa virar escolha na tela)
// ---------------------------------------------------------------------------
{
  certo(recusaPorCpfJaCadastrado('CPF ja cadastrado como NEZILDA RIBEIRO DE SOUZA (matricula 68182). Confirme se e vinculo adicional da mesma pessoa.'),
    'reconhece a mensagem real do banco, sem acento')
  certo(recusaPorCpfJaCadastrado('Este CPF já está cadastrado para FULANO'), 'reconhece variante acentuada')
  certo(!recusaPorCpfJaCadastrado('Ja existe um cadastro ativo com a matricula 53599'),
    'colisao de matricula NAO e tratada como recusa de CPF')
  certo(!recusaPorCpfJaCadastrado(null) && !recusaPorCpfJaCadastrado(''), 'null/vazio: falso')
  certo(!recusaPorCpfJaCadastrado('Voce nao tem acesso a esta unidade.'), 'erro de escopo: falso')
}

console.log(`\n${ok} asserções OK, ${falhas.length} falhas`)
if (falhas.length) {
  falhas.forEach(f => console.log(`  REPROVADO: ${f}`))
  process.exit(1)
}
console.log('PORTAO OK')
