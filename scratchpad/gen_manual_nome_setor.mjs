/**
 * Gerador: acrescenta ao manual do usuario a explicacao do aviso de nome de setor parecido.
 *
 * O manual e' parte do sistema (CLAUDE.md): mudanca que altera o que o usuario ve ou faz entra no
 * mesmo commit. Texto para COORDENADOR — sem nome de tabela, funcao ou tela interna.
 */
import fs from 'node:fs'

const p = 'src/app/(dashboard)/ajuda/conteudo/gestao.ts'
let s = fs.readFileSync(p, 'utf8')
const EOL = s.includes('\r\n') ? '\r\n' : '\n'
const eol = t => t.split('\n').join(EOL)

const ancora = `        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Desativar em vez de excluir',`

const novo = `        { tipo: 'titulo', texto: 'Dois nomes para o mesmo setor' },
        {
          tipo: 'p',
          texto:
            'O nome do setor sai de uma lista compartilhada por toda a rede. Quando você digita um nome que ainda não está nela, o sistema **cria um nome novo** — e é assim que o mesmo setor acaba com dois nomes diferentes. Foi o que aconteceu com *SERVIÇOS GERAIS* e *ASG AGENTE DE SERVIÇOS GERAIS*, que conviveram em 27 unidades até serem padronizados.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'O sistema avisa quando o nome parece com um que já existe',
          texto:
            'Ao digitar um nome parecido com outro já cadastrado, aparece um aviso com os nomes semelhantes e um botão para **usar o que já existe**. Se for mesmo outro setor, marque a confirmação e siga. Acento, maiúscula e pontuação não criam nome novo: *Serviços Gerais* e *SERVIÇOS GERAIS* são o mesmo nome para o sistema.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Dois nomes valendo atrapalham a transferência',
          texto:
            'Com os dois cadastrados na mesma unidade, quem transfere um servidor vê as duas opções na lista de destino e pode escolher a errada — a pessoa fica sozinha num setor paralelo, fora da escala dos colegas, e ninguém é avisado. Se a sua unidade já tem os dois, **funda um no outro** na tela de Setores: servidores, escalas e ponto vão junto.',
        },
${ancora}`

const achou = s.split(eol(ancora)).length - 1
if (achou !== 1) {
  console.error(`ABORTA: ancora achada ${achou}x, esperado 1x`)
  process.exit(1)
}
s = s.split(eol(ancora)).join(eol(novo))
fs.writeFileSync(p, s)
console.log('manual: 3 blocos acrescentados a secao "Os cadastros que definem as regras"')
