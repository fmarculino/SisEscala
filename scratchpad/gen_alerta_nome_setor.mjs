/**
 * Gerador: liga a deteccao de nome parecido (src/utils/setores/nomeSetor.ts) nas duas acoes que
 * gravam nome de setor.
 *
 * Copia mecanica com contagem, no padrao do projeto (armadilha 1): cada substituicao declara
 * quantas ocorrencias espera e o script ABORTA se a conta nao bater — a alternativa e' um
 * `replace` que vira no-op silencioso quando o trecho muda de indentacao ou de EOL.
 */
import fs from 'node:fs'

const p = 'src/app/(dashboard)/setores/actions.ts'
let s = fs.readFileSync(p, 'utf8')

// ⚠️ DETECTAR o fim de linha, nunca assumi-lo: este arquivo esta em CRLF (a convencao do projeto),
// mas montar o padrao com o EOL errado faz a substituicao virar no-op silencioso — o gerador
// "passaria" sem ter trocado nada. Aqui ele aborta, porque conta ocorrencias.
const EOL = s.includes('\r\n') ? '\r\n' : '\n'
const eol = t => t.split('\n').join(EOL)

function sub(deBruto, paraBruto, n = 1) {
  const de = eol(deBruto), para = eol(paraBruto)
  const achou = s.split(de).length - 1
  if (achou !== n) {
    console.error(`ABORTA: trecho achado ${achou}x, esperado ${n}x:\n---\n${de.slice(0, 160)}\n---`)
    process.exit(1)
  }
  s = s.split(de).join(para)
}

// 1) import da fonte unica
sub(
  `import { revalidatePath } from 'next/cache'`,
  `import { revalidatePath } from 'next/cache'
import {
  encontrarNomeIdentico,
  sugerirNomesParecidos,
  descreverNomesParecidos,
  type NomeParecido,
} from '@/utils/setores/nomeSetor'`,
)

// 2) o resolver ganha a confirmacao, reusa o identico e recusa o parecido
sub(
  `async function resolverDicionarioSetor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nomeBruto: string
): Promise<{ id: string } | { error: string }> {`,
  `// ⚠️ \`confirmadoNomeNovo\` vem do formulario e so' vale depois que a pessoa VIU a lista de nomes
// parecidos (o checkbox nasce desmarcado a cada nome digitado). Sem essa confirmacao, nome
// parecido com um ja existente e' RECUSADO — ver a recusa no fim desta funcao.
async function resolverDicionarioSetor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nomeBruto: string,
  confirmadoNomeNovo = false
): Promise<{ id: string } | { error: string; parecidos?: NomeParecido[] }> {`,
)

sub(
  `  if (existente) {
    return { id: existente.id }
  }

  const { data: criado, error: criaError } = await supabase`,
  `  if (existente) {
    return { id: existente.id }
  }

  // Nao existe entrada com o nome EXATO. Antes de criar uma — que e' o que fazia o dicionario
  // crescer por digitacao livre — confere o catalogo inteiro.
  const { data: catalogo, error: listaError } = await supabase
    .from('dicionario_setores')
    .select('id, nome')
    .order('nome')

  if (listaError) {
    return { error: 'Erro ao consultar o dicionário de setores: ' + listaError.message }
  }

  const nomes = (catalogo || []).map(d => d.nome)

  // Mesmo nome com outra caixa, acento ou pontuacao ("SERVICOS GERAIS" x "SERVIÇOS GERAIS") e' o
  // MESMO setor: reusa a entrada, sem perguntar nada. Transformar isso em pergunta so' ensinaria
  // a clicar sem ler — e o nome que o usuario ve continua sendo o que ja estava no dicionario.
  const identico = encontrarNomeIdentico(nome, nomes)
  if (identico) {
    const entrada = (catalogo || []).find(d => d.nome === identico)
    if (entrada) return { id: entrada.id }
  }

  // Parecido, mas nao igual: recusa e devolve a lista para a tela mostrar. Quem confirmar que e'
  // outro setor passa — a trava e' contra o engano, nunca contra nome novo legitimo.
  //
  // 🚨 A tela tambem avisa enquanto se digita, mas a tela NAO e' a defesa: server action e' um
  //   POST chamavel direto (armadilha 33). Quem decide e' esta funcao.
  if (!confirmadoNomeNovo) {
    const parecidos = sugerirNomesParecidos(nome, nomes)
    if (parecidos.length > 0) {
      return { error: descreverNomesParecidos(nome, parecidos), parecidos }
    }
  }

  const { data: criado, error: criaError } = await supabase`,
)

// 3) os dois chamadores (createSetor e updateSetor) repassam a confirmacao e o motivo da recusa
sub(
  `  const dict = await resolverDicionarioSetor(supabase, nome)
  if ('error' in dict) {
    return { error: dict.error }
  }`,
  `  const dict = await resolverDicionarioSetor(supabase, nome, formData.get('confirmar_nome_novo') === 'true')
  if ('error' in dict) {
    return { error: dict.error, parecidos: dict.parecidos }
  }`,
  2,
)

// invariantes: o que nao pode ter se perdido na copia
const invariantes = [
  [`.eq('nome', nome)`, 2, 'busca pelo nome exato (e a releitura da corrida) preservadas'],
  [`criaError.code === '42501'`, 1, 'traducao da recusa de RLS preservada'],
  [`confirmar_nome_novo`, 2, 'createSetor e updateSetor repassam a confirmacao'],
]
for (const [trecho, esperado, descricao] of invariantes) {
  const achou = s.split(trecho).length - 1
  if (achou !== esperado) {
    console.error(`ABORTA invariante (${descricao}): ${achou}x, esperado ${esperado}x`)
    process.exit(1)
  }
}

fs.writeFileSync(p, s)
console.log('actions.ts: 4 substituicoes aplicadas, 3 invariantes conferidos')
