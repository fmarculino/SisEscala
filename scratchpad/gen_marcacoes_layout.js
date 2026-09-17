/**
 * Layout da tela /marcacoes: abas escondidas e largura desperdicada.
 *
 * Duas causas, medidas na tela do usuario (1920px):
 *   1. `max-w-5xl` (1024px) num `<main>` de ~1660px uteis — sobravam ~600px vazios, e as 10 abas
 *      nao cabiam nos 1024;
 *   2. a barra de abas era `flex gap-2` SEM `flex-wrap` e SEM overflow proprio: as abas que nao
 *      cabiam eram simplesmente recortadas, sem barra de rolagem e sem nenhum sinal de que
 *      existiam. "Higiene do Relogio", "Importar por Pendrive" e "Autorizacoes do RH" ficavam
 *      inalcancaveis, e a pagina inteira ganhava rolagem horizontal.
 *
 * E o mesmo defeito do menu de Ferramentas da grade (issue #5): conteudo fora de alcance sem
 * nada indicando que ele existe.
 */
const fs = require('fs')

function editar(path, trocas, invariantes, marcaDeAplicado) {
  let src = fs.readFileSync(path, 'utf8')
  const EOL = src.includes('\r\n') ? '\r\n' : '\n'
  const L = (...linhas) => linhas.join(EOL)

  if (marcaDeAplicado && src.includes(marcaDeAplicado)) {
    console.log('JA APLICADO em ' + path + ' — nada a fazer')
    return
  }

  for (const [de, para, nome] of trocas) {
    const alvo = Array.isArray(de) ? L(...de) : de
    const novo = Array.isArray(para) ? L(...para) : para
    const n = src.split(alvo).length - 1
    if (n !== 1) {
      console.error('ABORTADO em ' + path + ': ' + nome + ' — esperava 1 ocorrencia, achei ' + n)
      process.exit(1)
    }
    src = src.split(alvo).join(novo)
  }

  for (const [nome, marca] of invariantes) {
    if (!src.includes(marca)) {
      console.error('ABORTADO em ' + path + ': invariante perdida — ' + nome)
      process.exit(1)
    }
  }

  fs.writeFileSync(path, src)
  console.log('OK ' + path + ' (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
}

// ------------------------------------------------------------------ 1. a largura da pagina

editar(
  'src/app/(dashboard)/marcacoes/page.tsx',
  [
    [
      '    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">',
      [
        '    // ⚠️ Sem `p-*` aqui: o layout do dashboard ja envolve a pagina num `p-8`, e o padding',
        '    // duplo comia 64px de cada lado. E `max-w-[1600px]` no lugar de `max-w-5xl` (1024px):',
        '    // esta tela tem 10 abas e tabelas largas (Cobertura de Ponto), e o limite antigo',
        '    // espremia as abas ate elas serem recortadas numa tela em que sobravam 600px vazios.',
        '    // O teto continua existindo para a linha nao ficar absurda em monitor ultrawide.',
        '    <div className="space-y-6 max-w-[1600px] mx-auto">'
      ],
      'largura da pagina'
    ]
  ],
  [
    ['cabecalho preservado', 'Relógios de ponto (REP), terminais locais e pendências de revisão.'],
    ['props do client preservadas', 'escopoLimitado={podeGerir && !gerenciaSemEscopo(profile.role)}']
  ],
  'max-w-[1600px]'
)

// ------------------------------------------------------------------ 2. as abas

editar(
  'src/app/(dashboard)/marcacoes/MarcacoesClient.tsx',
  [
    [
      [
        '      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">',
        '        {abas.filter((a) => a.visivel).map((a) => (',
        '          <button',
        '            key={a.id}',
        '            onClick={() => setAba(a.id)}',
        '            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 -mb-px transition-colors ${'
      ],
      [
        '      {/* ⚠️ `flex-wrap`: sao 10 abas, e sem quebra elas eram RECORTADAS pela largura da',
        '          pagina — sem barra de rolagem e sem nada dizendo que existiam. "Higiene do',
        '          Relogio", "Importar por Pendrive" e "Autorizacoes do RH" ficavam inalcancaveis, e',
        '          a pagina inteira ganhava rolagem horizontal. Quebrar em duas linhas mostra tudo;',
        '          esconder nao era opcao, porque a aba escondida nao tem como ser descoberta. */}',
        '      <div className="flex flex-wrap gap-x-1 gap-y-0 border-b border-zinc-200 dark:border-zinc-800">',
        '        {abas.filter((a) => a.visivel).map((a) => (',
        '          <button',
        '            key={a.id}',
        '            onClick={() => setAba(a.id)}',
        '            title={a.label}',
        '            className={`flex items-center gap-2 px-3 py-3 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${'
      ],
      'barra de abas com quebra de linha'
    ]
  ],
  [
    ['abas continuam filtradas por visibilidade', 'abas.filter((a) => a.visivel)'],
    ['badge de alerta preservado', '{!!a.alerta && ('],
    ['aba ativa continua marcada', "'border-blue-600 text-blue-600'"],
    ['conteudo das abas preservado', "{aba === 'autorizacoes' && <AutorizacoesPontoTab"]
  ],
  'flex-wrap gap-x-1'
)
