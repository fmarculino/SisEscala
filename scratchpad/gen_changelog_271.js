const fs = require('fs')
const path = 'CHANGELOG.md'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

if (src.includes('## [2.70.1]')) {
  console.log('JA APLICADO — nada a fazer')
  process.exit(0)
}

const ANCORA = '## [2.70.0] - 2026-09-17'
if (src.split(ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora da versao anterior nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVO = L(
  '## [2.70.1] - 2026-09-17',
  '',
  'Sem migration. Ajuste de layout, sem mudanca de regra.',
  '',
  '### Fixed',
  '',
  '- **Tres abas de Marcacoes eram inalcancaveis.** A barra tem 10 abas em `flex` sem quebra,',
  '  dentro de uma pagina limitada a `max-w-5xl` (1024px): as que nao cabiam eram **recortadas —',
  '  sem barra de rolagem e sem nenhum sinal de que existiam**. "Higiene do Relogio", "Importar por',
  '  Pendrive" e "Autorizacoes do RH" nao tinham como ser abertas, e a pagina inteira ganhava',
  '  rolagem horizontal. As abas passam a **quebrar em duas linhas**: esconder nao era opcao,',
  '  porque aba escondida nao tem como ser descoberta.',
  '- **A pagina desperdicava ~600px numa tela de 1920.** O `max-w-5xl` virou `max-w-[1600px]` e o',
  '  padding duplicado saiu (o layout do dashboard ja envolve a pagina num `p-8`). O teto continua',
  '  existindo para a linha nao ficar absurda em monitor ultrawide.',
  '- **Card de relogio com muitos setores empurrava a largura da pagina.** Num container flex o',
  '  filho nao encolhe abaixo do proprio `min-content` sem `min-w-0`, e o card do HMM lista dezenas',
  '  de setores atendidos numa linha so. Os botoes de acao ganharam `shrink-0` pelo motivo inverso:',
  '  nunca podem ser espremidos a nada.',
  '',
  ANCORA
)

src = src.split(ANCORA).join(NOVO)
fs.writeFileSync(path, src)
console.log('OK: CHANGELOG 2.70.1')
